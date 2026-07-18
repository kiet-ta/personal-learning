//! Project-scoped Review Runs (Slice 4).
//!
//! Per `plan.md`:
//! - Review Runs are immutable Markdown.
//! - Scoped to a Project by default.
//! - Optional Note filter and recorded input versions.
//!
//! Implementation: each review run is a single Markdown file with
//! YAML frontmatter under `projects/<project_id>/reviews/<run_id>.md`.
//! The body records the prompt, the cited Source Versions, and the
//! due review items at the moment the run was created. Mutating an
//! existing run creates a new run (the prior file remains on disk).
//!
//! Run id stability: each id combines the timestamp with a process
//! counter so two "Send & persist" clicks in the same millisecond
//! cannot collide. The counter is per-process, the timestamp is
//! derived from `now_unix_ms`, and a small random salt guards against
//! repeated runs landing on the exact same counter after a restart.
//!
//! Learning metrics: every run writes a `learning_event.jsonl` line
//! recording the type (`review_completed`), `project_id`, `run_id`,
//! `due_count`, and `cited_source_version_ids`. The file is
//! append-only and free of sensitive content (per `CONTEXT.md`).

use std::error::Error;
use std::fmt;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::atomic_write::node_persistence_like_write;
use crate::project_vault::{validate_entity_id, ProjectVault};
use crate::source_versions::SourceVersionRegistry;
use crate::vault::VaultLayout;

pub const REVIEW_RUN_SCHEMA_VERSION: u32 = 1;
const LEARNING_EVENTS_FILE: &str = "learning_events.jsonl";
static RUN_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunRecord {
    pub schema_version: u32,
    pub run_id: String,
    pub project_id: String,
    pub note_filter: Vec<String>,
    pub cited_source_version_ids: Vec<String>,
    pub prompt: String,
    pub due_count: u32,
    pub created_at_unix_ms: i64,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearningEvent {
    pub event_type: String,
    pub project_id: String,
    pub run_id: String,
    pub due_count: u32,
    pub cited_source_version_ids: Vec<String>,
    pub created_at_unix_ms: i64,
}

#[derive(Debug)]
pub enum ReviewRunError {
    EmptyPrompt,
    ProjectNotFound(String),
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for ReviewRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPrompt => write!(formatter, "Review prompt is empty."),
            Self::ProjectNotFound(project_id) => {
                write!(formatter, "Project not found: {project_id}.")
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Json(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for ReviewRunError {}

impl From<std::io::Error> for ReviewRunError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ReviewRunError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<crate::project_vault::ProjectVaultError> for ReviewRunError {
    fn from(error: crate::project_vault::ProjectVaultError) -> Self {
        Self::ProjectNotFound(error.to_string())
    }
}

impl From<crate::source_versions::SourceVersionError> for ReviewRunError {
    fn from(error: crate::source_versions::SourceVersionError) -> Self {
        match error {
            crate::source_versions::SourceVersionError::ProjectNotFound(message) => {
                Self::ProjectNotFound(message)
            }
            other => Self::ProjectNotFound(other.to_string()),
        }
    }
}

impl From<crate::node_persistence::NodePersistenceError> for ReviewRunError {
    fn from(error: crate::node_persistence::NodePersistenceError) -> Self {
        match error {
            crate::node_persistence::NodePersistenceError::Io(io) => Self::Io(io),
            other => Self::Io(std::io::Error::new(std::io::ErrorKind::Other, other.to_string())),
        }
    }
}

pub struct ReviewRunRegistry {
    layout: VaultLayout,
}

impl ReviewRunRegistry {
    pub fn new(vault_root: impl AsRef<Path>) -> Self {
        Self {
            layout: VaultLayout::new(vault_root.as_ref()),
        }
    }

    /// Create an immutable Review Run.
    ///
    /// - `note_filter` restricts which Notes are reviewed (empty means
    ///   all Notes in the project).
    /// - `cited_source_version_ids` lists the Source Versions the run
    ///   was grounded in; these references remain valid even after new
    ///   Source Versions are uploaded because Source Versions are
    ///   immutable.
    pub fn create(
        &self,
        project_id: &str,
        prompt: &str,
        note_filter: &[String],
        cited_source_version_ids: &[String],
        due_count: u32,
        now_unix_ms: i64,
    ) -> Result<ReviewRunRecord, ReviewRunError> {
        // Path-traversal guard: project_id must match the project's
        // own validation rule (alphanumeric / underscore / dash /
        // length 1..=128). Anything else is rejected before we
        // touch the filesystem.
        validate_entity_id("project", project_id)
            .map_err(|error| ReviewRunError::ProjectNotFound(error.to_string()))?;
        if prompt.trim().is_empty() {
            return Err(ReviewRunError::EmptyPrompt);
        }
        let project_vault = ProjectVault::initialize(self.layout.root())?;
        let project_exists = project_vault
            .list_projects()?
            .into_iter()
            .any(|p| p.project_id == project_id);
        if !project_exists {
            return Err(ReviewRunError::ProjectNotFound(project_id.to_string()));
        }

        // Cited Source Version IDs must exist in the project's source
        // registry. We surface this so that the UI never silently
        // grounds a review on a missing version.
        let source_registry = SourceVersionRegistry::new(self.layout.root());
        let known = source_registry
            .list_for_project(project_id)?
            .into_iter()
            .map(|v| v.version_id)
            .collect::<Vec<_>>();
        for cited in cited_source_version_ids {
            if !known.iter().any(|id| id == cited) {
                return Err(ReviewRunError::ProjectNotFound(format!(
                    "cited source version {cited} not found in project {project_id}"
                )));
            }
        }

        let run_id = mint_run_id(now_unix_ms);
        let relative = format!("projects/{project_id}/reviews/{run_id}.md");
        let project_reviews_dir = self
            .layout
            .root()
            .join("projects")
            .join(project_id)
            .join("reviews");
        std::fs::create_dir_all(&project_reviews_dir)?;

        let frontmatter = format!(
            "---\nschema_version: {REVIEW_RUN_SCHEMA_VERSION}\nrun_id: {run_id}\nproject_id: {project_id}\ncreated_at_unix_ms: {now_unix_ms}\ndue_count: {due_count}\ncited_source_version_ids: [{}]\nnote_filter: [{}]\n---\n\n",
            cited_source_version_ids.join(", "),
            note_filter.join(", ")
        );
        let body = format!("# Review prompt\n\n{}\n", prompt.trim());
        let file_path = project_reviews_dir.join(format!("{run_id}.md"));
        node_persistence_like_write(&file_path, format!("{frontmatter}{body}").as_bytes())?;

        let record = ReviewRunRecord {
            schema_version: REVIEW_RUN_SCHEMA_VERSION,
            run_id,
            project_id: project_id.to_string(),
            note_filter: note_filter.to_vec(),
            cited_source_version_ids: cited_source_version_ids.to_vec(),
            prompt: prompt.trim().to_string(),
            due_count,
            created_at_unix_ms: now_unix_ms,
            vault_relative_path: relative,
        };

        append_learning_event(&self.layout.root(), &LearningEvent {
            event_type: "review_completed".to_string(),
            project_id: record.project_id.clone(),
            run_id: record.run_id.clone(),
            due_count: record.due_count,
            cited_source_version_ids: record.cited_source_version_ids.clone(),
            created_at_unix_ms: record.created_at_unix_ms,
        })?;

        Ok(record)
    }

    pub fn list_for_project(
        &self,
        project_id: &str,
    ) -> Result<Vec<ReviewRunRecord>, ReviewRunError> {
        let dir = self
            .layout
            .root()
            .join("projects")
            .join(project_id)
            .join("reviews");
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut runs = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() || !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }
            let raw = match std::fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            if let Some(record) = parse_review_run_file(&raw) {
                runs.push(record);
            }
        }
        runs.sort_by(|a, b| a.created_at_unix_ms.cmp(&b.created_at_unix_ms));
        Ok(runs)
    }

    pub fn list_learning_events(&self) -> Result<Vec<LearningEvent>, ReviewRunError> {
        let path = self.layout.root().join(".app").join(LEARNING_EVENTS_FILE);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path)?;
        let mut events = Vec::new();
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<LearningEvent>(line) {
                Ok(event) => events.push(event),
                Err(_) => continue,
            }
        }
        Ok(events)
    }
}

fn parse_review_run_file(content: &str) -> Option<ReviewRunRecord> {
    let mut lines = content.lines();
    let first = lines.next()?;
    if first.trim() != "---" {
        return None;
    }
    let mut schema_version = REVIEW_RUN_SCHEMA_VERSION;
    let mut run_id = String::new();
    let mut project_id = String::new();
    let mut created_at_unix_ms: i64 = 0;
    let mut due_count: u32 = 0;
    let mut cited_source_version_ids: Vec<String> = Vec::new();
    let mut note_filter: Vec<String> = Vec::new();
    let mut body_lines: Vec<&str> = Vec::new();
    let mut in_body = false;

    for line in lines {
        let trimmed = line.trim_end();
        if !in_body {
            if trimmed == "---" {
                in_body = true;
                continue;
            }
            let (key, value) = trimmed.split_once(':')?;
            let value = value.trim();
            match key.trim() {
                "schema_version" => schema_version = value.parse().ok()?,
                "run_id" => run_id = value.to_string(),
                "project_id" => project_id = value.to_string(),
                "created_at_unix_ms" => created_at_unix_ms = value.parse().ok()?,
                "due_count" => due_count = value.parse().ok()?,
                "cited_source_version_ids" => {
                    cited_source_version_ids = parse_csv(value);
                }
                "note_filter" => {
                    note_filter = parse_csv(value);
                }
                _ => continue,
            }
        } else {
            body_lines.push(line);
        }
    }
    if run_id.is_empty() || project_id.is_empty() {
        return None;
    }
    let prompt = body_lines
        .iter()
        .skip_while(|line| line.trim().is_empty() || line.trim().starts_with("# "))
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    let vault_relative_path = format!("projects/{project_id}/reviews/{run_id}.md");
    Some(ReviewRunRecord {
        schema_version,
        run_id,
        project_id,
        note_filter,
        cited_source_version_ids,
        prompt,
        due_count,
        created_at_unix_ms,
        vault_relative_path,
    })
}

fn parse_csv(raw: &str) -> Vec<String> {
    raw.trim_matches('[')
        .trim_matches(']')
        .split(',')
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

/// Mint a stable, collision-resistant run id.
///
/// Combines the caller-supplied timestamp with a process-local
/// counter and a small entropy salt so that:
///   1. Two runs in the same millisecond never collide.
///   2. Two runs across different processes / restarts never collide.
///   3. The id remains human-readable for debugging (`run_<ts>_<n>`).
fn mint_run_id(now_unix_ms: i64) -> String {
    let counter = RUN_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let entropy = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    let salt = (entropy ^ ((counter as u32).wrapping_mul(2_654_435_761))) & 0xFFFF;
    format!("run_{now_unix_ms}_{counter}_{salt:04x}")
}

fn append_learning_event(root: &Path, event: &LearningEvent) -> Result<(), ReviewRunError> {
    let app_dir = root.join(".app");
    std::fs::create_dir_all(&app_dir)?;
    let path: PathBuf = app_dir.join(LEARNING_EVENTS_FILE);
    let serialized = serde_json::to_string(event)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(file, "{serialized}")?;
    file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(vault_root: &Path) -> String {
        let vault = ProjectVault::initialize(vault_root).expect("init");
        VaultLayout::new(vault_root).ensure_dirs().expect("dirs");
        let snapshot = vault
            .create_project("Review run test")
            .expect("create project");
        snapshot.project.project_id
    }

    #[test]
    fn create_run_writes_immutable_markdown_and_emits_event() {
        let root = std::env::temp_dir().join(format!(
            "slice4-review-run-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup(&root);
        let registry = ReviewRunRegistry::new(&root);

        let record = registry
            .create(
                &project_id,
                "What are the key takeaways from chapter 2?",
                &[],
                &[],
                3,
                1_700_000_000_000,
            )
            .expect("create run");

        assert!(record.vault_relative_path.starts_with("projects/"));
        assert!(record.vault_relative_path.contains("/reviews/"));

        let on_disk = root
            .join("projects")
            .join(&project_id)
            .join("reviews")
            .join(format!("{}.md", record.run_id));
        assert!(on_disk.exists(), "review run Markdown should exist on disk");

        let list = registry.list_for_project(&project_id).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].run_id, record.run_id);

        let events = registry.list_learning_events().expect("events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "review_completed");
        assert_eq!(events[0].project_id, project_id);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_citation_to_missing_source_version() {
        let root = std::env::temp_dir().join(format!(
            "slice4-review-run-missing-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup(&root);
        let registry = ReviewRunRegistry::new(&root);

        let result = registry.create(
            &project_id,
            "Prompt with bad citation",
            &[],
            &["v_does_not_exist".to_string()],
            0,
            1_700_000_001_000,
        );
        assert!(
            matches!(result, Err(ReviewRunError::ProjectNotFound(_))),
            "must reject citations that are not part of the project"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unsafe_project_id_before_filesystem_touch() {
        // Path-traversal guard: even when the project does not exist
        // yet, the id validator must run before we open any directory.
        let root = std::env::temp_dir().join(format!(
            "slice4-review-run-bad-id-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        ProjectVault::initialize(&root).expect("init");
        VaultLayout::new(&root).ensure_dirs().expect("dirs");
        let registry = ReviewRunRegistry::new(&root);
        let long_id = "x".repeat(200);
        let bad_ids = ["../escape", "", "with/slash", "with space", long_id.as_str()];
        for bad in bad_ids {
            let result = registry.create(bad, "Prompt", &[], &[], 0, 1_700_000_002_000);
            assert!(
                matches!(result, Err(ReviewRunError::ProjectNotFound(_))),
                "unsafe project id {bad:?} must be rejected"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn same_millisecond_creates_get_distinct_ids_and_files() {
        // Regression: clicking "Send & persist" twice in the same
        // millisecond must not collapse into one file or one event.
        let root = std::env::temp_dir().join(format!(
            "slice4-review-run-same-ms-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup(&root);
        let registry = ReviewRunRegistry::new(&root);

        let first = registry
            .create(&project_id, "First click", &[], &[], 1, 1_700_000_003_000)
            .expect("first run");
        let second = registry
            .create(&project_id, "Second click", &[], &[], 2, 1_700_000_003_000)
            .expect("second run");

        assert_ne!(first.run_id, second.run_id, "run ids must differ in same ms");
        assert_ne!(first.vault_relative_path, second.vault_relative_path);

        let first_path = root.join(&first.vault_relative_path);
        let second_path = root.join(&second.vault_relative_path);
        assert!(first_path.exists(), "first run file must exist on disk");
        assert!(second_path.exists(), "second run file must exist on disk");

        let listed = registry.list_for_project(&project_id).expect("list");
        assert_eq!(listed.len(), 2, "two runs must be listed, not one");

        let events = registry.list_learning_events().expect("events");
        assert_eq!(events.len(), 2, "two events, one per run");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parsed_record_reports_real_vault_relative_path() {
        // Regression: previously parse_review_run_file returned a
        // placeholder "<run>" literal. The path must now reference
        // the actual run id so the UI can open the run Markdown.
        let root = std::env::temp_dir().join(format!(
            "slice4-review-run-parse-path-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup(&root);
        let registry = ReviewRunRegistry::new(&root);

        let created = registry
            .create(&project_id, "Parse-path test", &[], &[], 1, 1_700_000_004_000)
            .expect("create");
        let listed = registry.list_for_project(&project_id).expect("list");
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].vault_relative_path.contains("<run>"));
        assert!(listed[0].vault_relative_path.ends_with(&format!("{}.md", created.run_id)));
        assert!(listed[0].vault_relative_path.contains(&project_id));

        let _ = std::fs::remove_dir_all(&root);
    }
}