//! PET (Personal Exam Trainer) companion — Slice 5 MVP.
//!
//! PET is a vault-level companion with these constraints:
//! - Uses Project context but is vault-wide.
//! - Never mutates canonical data autonomously.
//! - Paid AI is invoked only after explicit user action (the "Generate" button).
//!
//! The PET analyzer reads the vault and produces read-only "action cards"
//! organized into three categories: Knowledge, Study, and Projects.
//! Each category contains actionable insights derived from existing vault data.
//! No data is modified; no AI calls are made without user consent.
//!
//! ## Determinism contract
//!
//! The same `(vault_state, project_id, as_of_unix_ms)` triple MUST produce the
//! same `PetCompanionOutput`. The analyzer therefore never reads wall-clock
//! time. Callers (the Tauri command and tests) inject `as_of_unix_ms` so
//! behavior is reproducible and time-windowed rules ("recent", "since N days
//! ago") are deterministic with respect to an explicit anchor.

use std::collections::HashMap;
use std::fmt;

use crate::project_vault::ProjectVault;
use crate::review_runs::{ReviewRunRecord, ReviewRunRegistry};
use crate::source_versions::SourceVersionRegistry;
use crate::VaultLayout;

/// A category of action cards produced by the PET analyzer.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionCardCategory {
    Knowledge,
    Study,
    Projects,
}

impl ActionCardCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Knowledge => "knowledge",
            Self::Study => "study",
            Self::Projects => "projects",
        }
    }

    fn order(&self) -> u8 {
        match self {
            Self::Knowledge => 0,
            Self::Study => 1,
            Self::Projects => 2,
        }
    }
}

/// The priority level of an action card, affecting display order.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CardPriority {
    High,
    Medium,
    Low,
}

impl CardPriority {
    fn order(&self) -> u8 {
        match self {
            Self::High => 0,
            Self::Medium => 1,
            Self::Low => 2,
        }
    }
}

/// One action card produced by the PET analyzer.
/// Read-only; never mutates canonical data.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCard {
    pub id: String,
    pub category: ActionCardCategory,
    pub priority: CardPriority,
    /// Short title for the card.
    pub title: String,
    /// Human-readable insight or suggestion.
    pub body: String,
    /// Optional anchor: note_id, source_version_id, or run_id.
    /// `None` means the card is advisory and not yet anchored to a specific entity.
    pub anchor_type: Option<AnchorType>,
    pub anchor_id: Option<String>,
}

/// What an action card anchors to.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorType {
    Note,
    SourceVersion,
    ReviewRun,
    Project,
}

/// The complete output of the PET analyzer for a given project context.
/// Organized by category for display.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCompanionOutput {
    pub schema_version: u32,
    pub project_id: String,
    /// Reference timestamp the analyzer was anchored to. Equal to the caller-supplied
    /// `as_of_unix_ms` so the same vault snapshot is reproducible.
    pub as_of_unix_ms: i64,
    pub cards: Vec<ActionCard>,
    /// Summary counts per category.
    pub category_counts: HashMap<String, u32>,
}

impl PetCompanionOutput {
    pub fn new(project_id: String, as_of_unix_ms: i64) -> Self {
        Self {
            schema_version: 1,
            project_id,
            as_of_unix_ms,
            cards: Vec::new(),
            category_counts: HashMap::new(),
        }
    }

    pub fn add_card(&mut self, card: ActionCard) {
        let cat_key = card.category.as_str().to_string();
        *self.category_counts.entry(cat_key).or_insert(0) += 1;
        self.cards.push(card);
    }

    pub fn sort_cards(&mut self) {
        self.cards.sort_by(|a, b| {
            let ord_a = (a.category.order(), a.priority.order());
            let ord_b = (b.category.order(), b.priority.order());
            ord_a.cmp(&ord_b).then_with(|| a.title.cmp(&b.title))
        });
    }
}

/// Errors that can occur in PET analysis. These preserve the underlying cause
/// so the UI can render a meaningful message instead of a misleading
/// "Project not found" wrapper.
#[derive(Debug)]
pub enum PetError {
    /// The project manifest was not found in the vault.
    ProjectNotFound(String),
    /// The supplied `project_id` failed validation (e.g. `../escape`).
    InvalidProjectId(String),
    /// `ProjectVault::initialize` reported an I/O or filesystem error.
    VaultInitialize(String),
    /// Reading notes from the project failed.
    NotesRead(String),
    /// Reading source versions from the project failed.
    SourceVersionsRead(String),
    /// Reading review runs from the project failed.
    ReviewRunsRead(String),
    /// `ReviewRunRegistry` reported an error.
    ReviewRuns(String),
}

impl fmt::Display for PetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProjectNotFound(id) => write!(f, "Project not found: {id}"),
            Self::InvalidProjectId(id) => {
                write!(f, "Invalid project id (rejected by path validator): {id}")
            }
            Self::VaultInitialize(msg) => write!(f, "Failed to initialize vault: {msg}"),
            Self::NotesRead(msg) => write!(f, "Failed to read notes: {msg}"),
            Self::SourceVersionsRead(msg) => {
                write!(f, "Failed to read source versions: {msg}")
            }
            Self::ReviewRunsRead(msg) => write!(f, "Failed to read review runs: {msg}"),
            Self::ReviewRuns(msg) => write!(f, "Review run registry error: {msg}"),
        }
    }
}

impl std::error::Error for PetError {}

// ---------------------------------------------------------------------------
// PET Analyzer
// ---------------------------------------------------------------------------

/// Analyze the given project vault and produce action cards.
///
/// ## Determinism
/// Given the same `(vault state, project_id, as_of_unix_ms)`, this function
/// produces the same `PetCompanionOutput`. The caller injects `as_of_unix_ms`
/// so "recent" and "days since last run" rules are reproducible.
///
/// ## Vault writes
/// PET never writes to canonical data. It reads the vault via
/// `ProjectVault::load_project` and `list_notes` (read-only),
/// `SourceVersionRegistry::list_for_project` (read-only), and
/// `ReviewRunRegistry::list_for_project` (read-only).
pub fn analyze_project(
    project_id: &str,
    vault_layout: &VaultLayout,
    as_of_unix_ms: i64,
) -> Result<PetCompanionOutput, PetError> {
    // Validate project_id before any filesystem touch.
    crate::project_vault::validate_entity_id("project", project_id).map_err(|_| {
        PetError::InvalidProjectId(project_id.to_string())
    })?;

    let mut output = PetCompanionOutput::new(project_id.to_string(), as_of_unix_ms);

    // Initialize the vault (read-only on existing roots; only creates directories
    // if they do not already exist, which is idempotent and does not touch
    // canonical content).
    let vault = ProjectVault::initialize(vault_layout.root().to_path_buf())
        .map_err(|e| PetError::VaultInitialize(e.to_string()))?;
    vault
        .load_project(project_id)
        .map_err(|_| PetError::ProjectNotFound(project_id.to_string()))?;

    // Read notes. A failure here is surfaced, not swallowed.
    let notes = vault
        .list_notes(project_id)
        .map_err(|e| PetError::NotesRead(e.to_string()))?;

    // Read source versions. A failure here is surfaced.
    let sv_registry = SourceVersionRegistry::new(vault_layout.root());
    let source_versions = sv_registry
        .list_for_project(project_id)
        .map_err(|e| PetError::SourceVersionsRead(e.to_string()))?;

    // Read review runs through the canonical registry so PET and the metrics
    // dashboard share one parser and one source of truth.
    let review_run_registry = ReviewRunRegistry::new(vault_layout.root());
    let review_runs = review_run_registry
        .list_for_project(project_id)
        .map_err(|e| PetError::ReviewRuns(e.to_string()))?;

    let metrics = derive_pet_metrics(&review_runs, as_of_unix_ms);

    // --- Knowledge Cards ---
    if notes.len() >= 5 && source_versions.is_empty() {
        output.add_card(ActionCard {
            id: format!("{project_id}-k-sources"),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::High,
            title: "Add sources to connect your notes".to_string(),
            body: format!(
                "You have {} notes but no imported source versions yet. \
                Importing PDFs, articles, or documents gives the AI evidence to \
                connect your notes with real references.",
                notes.len()
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    if source_versions.len() >= 3 && notes.len() < source_versions.len() {
        output.add_card(ActionCard {
            id: format!("{project_id}-k-notes"),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::Medium,
            title: "Convert sources into notes".to_string(),
            body: format!(
                "You have {} source versions but only {} notes. \
                Try the Review workspace — it can help you extract knowledge \
                from your sources and create connected notes.",
                source_versions.len(),
                notes.len()
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    if notes.len() >= 5 && source_versions.len() >= 3 {
        output.add_card(ActionCard {
            id: format!("{project_id}-k-rich"),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::Low,
            title: "Rich vault foundation".to_string(),
            body: format!(
                "You have {} notes and {} source versions. \
                Your vault has good material for knowledge synthesis.",
                notes.len(),
                source_versions.len()
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    // --- Study Cards ---
    if metrics.total_runs == 0 && notes.len() >= 3 {
        output.add_card(ActionCard {
            id: format!("{project_id}-s-start"),
            category: ActionCardCategory::Study,
            priority: CardPriority::High,
            title: "Start your first review session".to_string(),
            body: format!(
                "You have {} notes but no review runs yet. \
                Try the Review workspace to start spaced-repetition sessions. \
                The AI can help you find evidence in your sources.",
                notes.len()
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    if metrics.recent_run_count >= 3 {
        output.add_card(ActionCard {
            id: format!("{project_id}-s-streak"),
            category: ActionCardCategory::Study,
            priority: CardPriority::Medium,
            title: "Great study streak".to_string(),
            body: format!(
                "You've completed {} review runs recently (within the {}ms window). \
                Your consistency builds lasting knowledge. Keep going!",
                metrics.recent_run_count, metrics.consistency_window_ms
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    if metrics.unique_cited_source_versions >= 3 {
        output.add_card(ActionCard {
            id: format!("{project_id}-s-evidence"),
            category: ActionCardCategory::Study,
            priority: CardPriority::Medium,
            title: "Evidence-based learning".to_string(),
            body: format!(
                "You've cited {} unique source versions across review runs. \
                Evidence-backed study creates stronger knowledge.",
                metrics.unique_cited_source_versions
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    // "Time to review again" measures time elapsed since the latest run, anchored
    // to the explicit `as_of_unix_ms`. It only fires when at least one run
    // exists and the elapsed time is >= 3 days.
    if metrics.total_runs >= 1 {
        if let Some(days_since) = metrics.days_since_last_run(as_of_unix_ms) {
            if days_since >= 3 {
                output.add_card(ActionCard {
                    id: format!("{project_id}-s-gap"),
                    category: ActionCardCategory::Study,
                    priority: CardPriority::High,
                    title: "Time to review again".to_string(),
                    body: format!(
                        "It's been {} days since your last review session. \
                        Regular review keeps knowledge fresh.",
                        days_since
                    ),
                    anchor_type: None,
                    anchor_id: None,
                });
            }
        }
    }

    if notes.len() == 1 {
        output.add_card(ActionCard {
            id: format!("{project_id}-s-build"),
            category: ActionCardCategory::Study,
            priority: CardPriority::Low,
            title: "Build your knowledge base".to_string(),
            body: "You've started with one note. As you learn, add more notes and \
                import sources to grow your connected knowledge graph."
                .to_string(),
            anchor_type: None,
            anchor_id: None,
        });
    }

    // --- Project Cards ---
    if notes.len() >= 5 {
        let tagged = notes.iter().filter(|n| !n.tags.is_empty()).count();
        let tag_ratio = if notes.is_empty() {
            0.0
        } else {
            tagged as f64 / notes.len() as f64
        };
        if tag_ratio < 0.3 {
            output.add_card(ActionCard {
                id: format!("{project_id}-p-tags"),
                category: ActionCardCategory::Projects,
                priority: CardPriority::Medium,
                title: "Add tags to your notes".to_string(),
                body: format!(
                    "Only {} of {} notes have tags. \
                    Adding tags helps filter notes and discovers connections.",
                    tagged,
                    notes.len()
                ),
                anchor_type: None,
                anchor_id: None,
            });
        }
    }

    if notes.len() >= 10 {
        output.add_card(ActionCard {
            id: format!("{project_id}-p-graph"),
            category: ActionCardCategory::Projects,
            priority: CardPriority::Low,
            title: "Explore your knowledge graph".to_string(),
            body: format!(
                "You have {} notes. Open the Graph workspace to see how \
                your knowledge connects.",
                notes.len()
            ),
            anchor_type: None,
            anchor_id: None,
        });
    }

    output.sort_cards();
    Ok(output)
}

// ---------------------------------------------------------------------------
// PET-level metrics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PetMetrics {
    pub total_runs: u32,
    pub recent_run_count: u32,
    pub unique_cited_source_versions: u32,
    pub latest_run_unix_ms: Option<i64>,
    pub consistency_window_ms: i64,
}

impl PetMetrics {
    pub fn days_since_last_run(&self, as_of_unix_ms: i64) -> Option<i64> {
        let latest = self.latest_run_unix_ms?;
        if latest > as_of_unix_ms {
            // Future-dated last run is treated as "just happened" for safety;
            // negative elapsed time is nonsense anyway.
            return Some(0);
        }
        Some((as_of_unix_ms - latest) / (24 * 60 * 60 * 1000))
    }
}

fn derive_pet_metrics(review_runs: &[ReviewRunRecord], as_of_unix_ms: i64) -> PetMetrics {
    let total_runs = review_runs.len() as u32;
    // 7-day "active learner" window for PET, narrower than full LearningMetrics
    // (which uses 14 days). Documented as a PET-specific threshold.
    let consistency_window_ms: i64 = 7 * 24 * 60 * 60 * 1000;

    let recent_run_count = review_runs
        .iter()
        .filter(|r| {
            r.created_at_unix_ms <= as_of_unix_ms
                && (as_of_unix_ms - r.created_at_unix_ms) <= consistency_window_ms
        })
        .count() as u32;

    // Deduplicate cited source version ids so a single cited version referenced
    // from many runs only counts once. This matches "evidence breadth", which is
    // what the Evidence-based learning card claims to measure.
    let mut unique_cited: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for run in review_runs {
        for id in &run.cited_source_version_ids {
            unique_cited.insert(id.clone());
        }
    }
    let unique_cited_source_versions = unique_cited.len() as u32;

    let latest_run_unix_ms = review_runs.iter().map(|r| r.created_at_unix_ms).max();

    PetMetrics {
        total_runs,
        recent_run_count,
        unique_cited_source_versions,
        latest_run_unix_ms,
        consistency_window_ms,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::MetricsThresholds;
    use crate::review_runs::ReviewRunRegistry;
    use crate::source_versions::SourceVersionRegistry;
    use std::path::PathBuf;

    fn test_vault_root(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("pet-test-{name}-{nanos}"))
    }

    #[test]
    fn pet_output_new_project_has_one_card() {
        let root = test_vault_root("one-card");
        let vault = ProjectVault::initialize(&root).expect("vault initializes");
        let snapshot = vault
            .create_project("Empty Project")
            .expect("project creates");

        let layout = VaultLayout::new(&root);
        let result = analyze_project(
            &snapshot.project.project_id,
            &layout,
            1_700_000_000_000,
        );
        assert!(result.is_ok(), "analyze should succeed: {:?}", result);
        let output = result.unwrap();
        assert_eq!(output.schema_version, 1);
        assert_eq!(output.project_id, snapshot.project.project_id);
        assert_eq!(output.as_of_unix_ms, 1_700_000_000_000);
        // 1 blank note, 0 sources, 0 review runs → "build your knowledge base" Study/Low card
        assert_eq!(
            output.cards.len(),
            1,
            "Expected 1 card for 1-note project, got: {:?}",
            output.cards
        );
        assert_eq!(output.cards[0].category, ActionCardCategory::Study);
        assert_eq!(output.cards[0].priority, CardPriority::Low);
        assert!(output.cards[0].title.contains("knowledge base"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_prioritizes_sources_for_large_note_count() {
        let root = test_vault_root("needs-sources");
        let vault = ProjectVault::initialize(&root).expect("vault initializes");
        let snapshot = vault
            .create_project("Notes Only")
            .expect("project creates");

        for i in 1..=4 {
            vault
                .create_note(&snapshot.project.project_id, &format!("Note {i}"))
                .expect("note creates");
        }

        let layout = VaultLayout::new(&root);
        let output = analyze_project(
            &snapshot.project.project_id,
            &layout,
            1_700_000_000_000,
        )
        .unwrap();

        let high_knowledge: Vec<_> = output
            .cards
            .iter()
            .filter(|c| c.category == ActionCardCategory::Knowledge && c.priority == CardPriority::High)
            .collect();
        assert!(
            !high_knowledge.is_empty(),
            "Expected high-priority Knowledge card but got none. Cards: {:?}",
            output.cards
        );
        assert!(
            high_knowledge[0].title.contains("sources"),
            "Expected 'sources' card, got: {}",
            high_knowledge[0].title
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_sort_orders_cards_by_category_then_priority_then_title() {
        let mut output = PetCompanionOutput::new("p".to_string(), 1_000);
        // Insert in a scrambled order; expect stable sort by category > priority > title.
        output.add_card(ActionCard {
            id: "p-p-medium-tags".to_string(),
            category: ActionCardCategory::Projects,
            priority: CardPriority::Medium,
            title: "Add tags to your notes".to_string(),
            body: String::new(),
            anchor_type: None,
            anchor_id: None,
        });
        output.add_card(ActionCard {
            id: "p-k-high-sources".to_string(),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::High,
            title: "Add sources to connect your notes".to_string(),
            body: String::new(),
            anchor_type: None,
            anchor_id: None,
        });
        output.add_card(ActionCard {
            id: "p-s-low-build".to_string(),
            category: ActionCardCategory::Study,
            priority: CardPriority::Low,
            title: "Build your knowledge base".to_string(),
            body: String::new(),
            anchor_type: None,
            anchor_id: None,
        });
        output.add_card(ActionCard {
            id: "p-k-low-rich".to_string(),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::Low,
            title: "Rich vault foundation".to_string(),
            body: String::new(),
            anchor_type: None,
            anchor_id: None,
        });

        output.sort_cards();
        let titles: Vec<&str> = output.cards.iter().map(|c| c.title.as_str()).collect();
        // Expected order: Knowledge (High sources, Low rich), Study (Low build), Projects (Medium tags).
        assert_eq!(
            titles,
            vec![
                "Add sources to connect your notes",
                "Rich vault foundation",
                "Build your knowledge base",
                "Add tags to your notes",
            ]
        );
    }

    #[test]
    fn pet_category_counts_accumulate() {
        let mut output = PetCompanionOutput::new("test".to_string(), 1_000);
        output.add_card(ActionCard {
            id: "a".to_string(),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::High,
            title: "A".to_string(),
            body: "B".to_string(),
            anchor_type: None,
            anchor_id: None,
        });
        output.add_card(ActionCard {
            id: "b".to_string(),
            category: ActionCardCategory::Knowledge,
            priority: CardPriority::Medium,
            title: "B".to_string(),
            body: "C".to_string(),
            anchor_type: None,
            anchor_id: None,
        });
        output.add_card(ActionCard {
            id: "c".to_string(),
            category: ActionCardCategory::Study,
            priority: CardPriority::High,
            title: "C".to_string(),
            body: "D".to_string(),
            anchor_type: None,
            anchor_id: None,
        });

        assert_eq!(*output.category_counts.get("knowledge").unwrap(), 2);
        assert_eq!(*output.category_counts.get("study").unwrap(), 1);
        assert_eq!(*output.category_counts.get("projects").unwrap_or(&0), 0);
    }

    #[test]
    fn pet_metrics_dedup_cited_source_versions() {
        let runs = vec![
            ReviewRunRecord {
                schema_version: 1,
                run_id: "run_1".to_string(),
                project_id: "p".to_string(),
                note_filter: Vec::new(),
                cited_source_version_ids: vec!["sv1".to_string(), "sv2".to_string()],
                prompt: String::new(),
                due_count: 3,
                created_at_unix_ms: 1_700_000_000_000,
                vault_relative_path: String::new(),
            },
            ReviewRunRecord {
                schema_version: 1,
                run_id: "run_2".to_string(),
                project_id: "p".to_string(),
                note_filter: Vec::new(),
                cited_source_version_ids: vec!["sv1".to_string(), "sv3".to_string()],
                prompt: String::new(),
                due_count: 2,
                created_at_unix_ms: 1_700_000_100_000,
                vault_relative_path: String::new(),
            },
        ];

        let now = 1_700_000_200_000; // 200s after run_2
        let metrics = derive_pet_metrics(&runs, now);
        assert_eq!(metrics.total_runs, 2);
        // sv1 cited twice + sv2 once + sv3 once → 3 unique
        assert_eq!(metrics.unique_cited_source_versions, 3);
        assert_eq!(metrics.recent_run_count, 2); // both within 7d window
        assert_eq!(metrics.latest_run_unix_ms, Some(1_700_000_100_000));
    }

    #[test]
    fn pet_days_since_last_run_is_anchored_to_explicit_now() {
        let runs = vec![ReviewRunRecord {
            schema_version: 1,
            run_id: "run_x".to_string(),
            project_id: "p".to_string(),
            note_filter: Vec::new(),
            cited_source_version_ids: Vec::new(),
            prompt: String::new(),
            due_count: 1,
            created_at_unix_ms: 1_700_000_000_000,
            vault_relative_path: String::new(),
        }];
        let metrics = derive_pet_metrics(&runs, 1_700_000_000_000);
        assert_eq!(metrics.days_since_last_run(1_700_000_000_000), Some(0));
        assert_eq!(
            metrics.days_since_last_run(1_700_000_000_000 + 3 * 24 * 60 * 60 * 1000),
            Some(3)
        );
    }

    #[test]
    fn pet_rejects_unsafe_project_id_before_filesystem_touch() {
        // Path-traversal and invalid id shapes must be rejected before any
        // directory lookup, matching `project_vault::validate_entity_id`.
        let root = test_vault_root("unsafe-id");
        std::fs::create_dir_all(&root).unwrap();
        let layout = VaultLayout::new(&root);

        let bad_ids = [
            "../escape",
            "with/slash",
            "with\\backslash",
            "with space",
            &"x".repeat(200),
        ];
        for bad in bad_ids {
            let result = analyze_project(bad, &layout, 1_700_000_000_000);
            assert!(
                matches!(result, Err(PetError::InvalidProjectId(_))),
                "expected InvalidProjectId for {bad:?}, got: {:?}",
                result
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_analyze_nonexistent_project_returns_error() {
        let root = test_vault_root("no-project");
        std::fs::create_dir_all(&root).expect("root creates");
        let layout = VaultLayout::new(&root);

        let result = analyze_project("nonexistent-id", &layout, 1_700_000_000_000);
        assert!(matches!(result, Err(PetError::ProjectNotFound(_))));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_analyze_is_deterministic_with_explicit_now() {
        // Same vault state + same as_of_unix_ms → same cards (byte-equal JSON).
        let root = test_vault_root("determinism");
        let vault = ProjectVault::initialize(&root).expect("vault initializes");
        let snapshot = vault
            .create_project("Determinism Test")
            .expect("project creates");
        let layout = VaultLayout::new(&root);

        let a = analyze_project(
            &snapshot.project.project_id,
            &layout,
            1_700_000_000_000,
        )
        .unwrap();
        let b = analyze_project(
            &snapshot.project.project_id,
            &layout,
            1_700_000_000_000,
        )
        .unwrap();
        assert_eq!(a, b);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_reads_review_runs_via_canonical_registry() {
        // End-to-end: create a project, write a real Review Run through the
        // canonical registry, and assert PET observes it. This catches the
        // "wrong directory / wrong field names" bug from the first review pass.
        let root = test_vault_root("e2e-runs");
        let vault = ProjectVault::initialize(&root).expect("vault initializes");
        let snapshot = vault
            .create_project("E2E Review")
            .expect("project creates");
        for i in 1..=3 {
            vault
                .create_note(&snapshot.project.project_id, &format!("Note {i}"))
                .expect("note creates");
        }

        // Write real Review Runs via the canonical registry (snake_case keys,
        // projects/<id>/reviews/<run_id>.md).
        let registry = ReviewRunRegistry::new(&root);
        let now = 1_700_000_000_000;
        for offset in [0i64, 3_600_000, 7_200_000] {
            registry
                .create(
                    &snapshot.project.project_id,
                    "test prompt",
                    &[],
                    &[],
                    1,
                    now + offset,
                )
                .expect("run creates");
        }

        let layout = VaultLayout::new(&root);
        let output = analyze_project(
            &snapshot.project.project_id,
            &layout,
            now + 86_400_000, // 1 day after the latest run
        )
        .unwrap();

        assert_eq!(output.cards.iter().filter(|c| matches!(c.id.as_str(), x if x.ends_with("-s-start"))).count(), 0,
            "Should NOT show 'start your first review session' when runs exist");
        // 3 runs within the 7-day window → streak card should fire.
        assert!(
            output.cards.iter().any(|c| c.id.ends_with("-s-streak")),
            "Expected streak card; cards: {:?}",
            output.cards
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_handles_missing_optional_source_versions_gracefully() {
        // The SourceVersionRegistry returns Ok(vec![]) when no source versions
        // exist; PET must not surface this as an error.
        let root = test_vault_root("no-sources");
        let vault = ProjectVault::initialize(&root).expect("vault initializes");
        let snapshot = vault
            .create_project("No Sources")
            .expect("project creates");
        for i in 1..=5 {
            vault
                .create_note(&snapshot.project.project_id, &format!("Note {i}"))
                .expect("note creates");
        }
        let layout = VaultLayout::new(&root);
        let result = analyze_project(
            &snapshot.project.project_id,
            &layout,
            1_700_000_000_000,
        );
        assert!(result.is_ok(), "analyze should succeed with no sources: {:?}", result);
        let output = result.unwrap();
        assert!(output.cards.iter().any(|c| c.id.ends_with("-k-sources")),
            "Should suggest adding sources; cards: {:?}", output.cards);

        let _ = std::fs::remove_dir_all(&root);
    }

    // Suppress unused-import warning for the helper types referenced by doc comments.
    #[allow(dead_code)]
    fn _keep_imports(_: &MetricsThresholds, _: &ReviewRunRegistry, _: &SourceVersionRegistry) {}
}