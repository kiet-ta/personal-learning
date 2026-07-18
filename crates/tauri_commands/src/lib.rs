use std::io;
use std::path::{Path, PathBuf};

use local_knowledge_core::{
    ActionCard, AnchorType, analyze_indexed_sources, analyze_project as analyze_pet_project,
    derive_learning_metrics, generate_knowledge_draft as generate_core_knowledge_draft,
    generate_knowledge_draft_from_source as generate_core_knowledge_draft_from_source,
    ingest_markdown_sources, list_ai_suggestions as list_core_ai_suggestions,
    record_suggestion_decision as record_core_suggestion_decision,
    save_ai_suggestions as save_core_ai_suggestions, save_learning_note as save_core_learning_note,
    AiSuggestion, CardPriority, DraftEdge, DraftNode, EvidenceLocator, IngestedSource, KnowledgeDraft,
    LearningNote, LearningMetrics, LegacyMigrationReport, LegacyMigrationStatus, LlmConfig,
    MetricsThresholds, NewAiSuggestion, PersistedNode, PetCompanionOutput, ProjectManifest,
    ProjectNote, ProjectSnapshot, ProjectVault, RagAnalysis, RetrievedChunk, ReviewRunRecord,
    ReviewRunRegistry, SourceUpload, SourceVersion, SourceVersionRegistry, SuggestionStatus,
    VaultLayout,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUploadRequest {
    pub source_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionRequest {
    pub suggestion_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub relation_kind: String,
    pub rationale: String,
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningNoteResponse {
    pub note_id: String,
    pub title: String,
    pub body_markdown: String,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningNoteListResponse {
    pub notes: Vec<LearningNoteResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifestResponse {
    pub schema_version: u32,
    pub project_id: String,
    pub title: String,
    pub slug: String,
    pub default_note_id: String,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResponse {
    pub projects: Vec<ProjectManifestResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoteResponse {
    pub schema_version: u32,
    pub project_id: String,
    pub note_id: String,
    pub title: String,
    pub slug: String,
    pub tags: Vec<String>,
    pub body_markdown: String,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub legacy_note_id: Option<String>,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoteListResponse {
    pub notes: Vec<ProjectNoteResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotResponse {
    pub project: ProjectManifestResponse,
    pub default_note: ProjectNoteResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationResponse {
    pub status: String,
    pub migrated_note_count: usize,
    pub imported_project_id: Option<String>,
    pub backup_vault_relative_path: Option<String>,
    pub content_sha256: Option<String>,
}

impl From<ProjectManifest> for ProjectManifestResponse {
    fn from(project: ProjectManifest) -> Self {
        Self {
            schema_version: project.schema_version,
            project_id: project.project_id,
            title: project.title,
            slug: project.slug,
            default_note_id: project.default_note_id,
            created_at_unix_ms: project.created_at_unix_ms,
            updated_at_unix_ms: project.updated_at_unix_ms,
        }
    }
}

impl From<ProjectNote> for ProjectNoteResponse {
    fn from(note: ProjectNote) -> Self {
        Self {
            schema_version: note.schema_version,
            project_id: note.project_id,
            note_id: note.note_id,
            title: note.title,
            slug: note.slug,
            tags: note.tags,
            body_markdown: note.body_markdown,
            created_at_unix_ms: note.created_at_unix_ms,
            updated_at_unix_ms: note.updated_at_unix_ms,
            legacy_note_id: note.legacy_note_id,
            vault_relative_path: note.vault_relative_path,
        }
    }
}

impl From<ProjectSnapshot> for ProjectSnapshotResponse {
    fn from(snapshot: ProjectSnapshot) -> Self {
        Self {
            project: ProjectManifestResponse::from(snapshot.project),
            default_note: ProjectNoteResponse::from(snapshot.default_note),
        }
    }
}

impl From<LegacyMigrationReport> for LegacyMigrationResponse {
    fn from(report: LegacyMigrationReport) -> Self {
        let status = match report.status {
            LegacyMigrationStatus::Migrated => "migrated",
            LegacyMigrationStatus::AlreadyCompleted => "alreadyCompleted",
            LegacyMigrationStatus::NoLegacyNotes => "noLegacyNotes",
        };
        Self {
            status: status.to_string(),
            migrated_note_count: report.migrated_note_count,
            imported_project_id: report.imported_project_id,
            backup_vault_relative_path: report.backup_vault_relative_path,
            content_sha256: report.content_sha256,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionResponse {
    pub suggestion_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub relation_kind: String,
    pub rationale: String,
    pub confidence: u8,
    pub status: String,
    pub created_at_unix_ms: i64,
    pub decided_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionListResponse {
    pub suggestions: Vec<AiSuggestionResponse>,
}

// ── Source Version Commands (Slice 3) ───────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceVersionResponse {
    pub schema_version: u32,
    pub project_id: String,
    pub source_id: String,
    pub version_id: String,
    pub source_name: String,
    pub sha256: String,
    pub modality: String,
    pub size_bytes: u64,
    pub created_at_unix_ms: i64,
    pub version_kind: String,
    pub vault_relative_path: String,
}

impl From<SourceVersion> for SourceVersionResponse {
    fn from(v: SourceVersion) -> Self {
        Self {
            schema_version: v.schema_version,
            project_id: v.project_id,
            source_id: v.source_id,
            version_id: v.version_id,
            source_name: v.source_name,
            sha256: v.sha256,
            modality: v.modality,
            size_bytes: v.size_bytes,
            created_at_unix_ms: v.created_at_unix_ms,
            version_kind: v.version_kind.to_string(),
            vault_relative_path: v.vault_relative_path,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceVersionListResponse {
    pub versions: Vec<SourceVersionResponse>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestProjectSourceRequest {
    pub project_id: String,
    pub source_id: Option<String>,
    pub source_name: String,
    pub content: String,
}

pub fn ingest_project_source(
    vault_root: PathBuf,
    request_json: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let request: IngestProjectSourceRequest =
        serde_json::from_str(&request_json).map_err(|error| error.to_string())?;
    let now_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let registry = SourceVersionRegistry::new(&vault_root);
    let version = registry
        .ingest(
            &request.project_id,
            request.source_id.as_deref(),
            &request.source_name,
            &request.content,
            now_unix_ms,
        )
        .map_err(|error| error.to_string())?;
    json(SourceVersionResponse::from(version))
}

pub fn list_project_source_versions(
    vault_root: PathBuf,
    project_id: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let registry = SourceVersionRegistry::new(&vault_root);
    let versions = registry
        .list_for_project(&project_id)
        .map_err(|error| error.to_string())?;
    json(SourceVersionListResponse {
        versions: versions.into_iter().map(SourceVersionResponse::from).collect(),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEvidenceRequest {
    pub version_id: String,
    pub content: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLocatorResponse {
    pub schema_version: u32,
    pub source_version_id: String,
    pub source_id: String,
    pub start_line: u32,
    pub end_line: u32,
    pub start_offset: u32,
    pub end_offset: u32,
    pub excerpt: String,
}

impl From<EvidenceLocator> for EvidenceLocatorResponse {
    fn from(value: EvidenceLocator) -> Self {
        Self {
            schema_version: value.schema_version,
            source_version_id: value.source_version_id,
            source_id: value.source_id,
            start_line: value.start_line,
            end_line: value.end_line,
            start_offset: value.start_offset,
            end_offset: value.end_offset,
            excerpt: value.excerpt,
        }
    }
}

pub fn build_evidence_locator_cmd(
    vault_root: PathBuf,
    project_id: String,
    request_json: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let request: BuildEvidenceRequest =
        serde_json::from_str(&request_json).map_err(|error| error.to_string())?;
    let registry = SourceVersionRegistry::new(&vault_root);
    let version = registry
        .read(&project_id, &request.version_id)
        .map_err(|error| error.to_string())?;
    let locator = local_knowledge_core::build_evidence_locator(
        &version,
        &request.content,
        request.start_line,
        request.end_line,
    );
    json(EvidenceLocatorResponse::from(locator))
}

// ── Review Run + Metrics Commands (Slice 4) ────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunResponse {
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

impl From<ReviewRunRecord> for ReviewRunResponse {
    fn from(record: ReviewRunRecord) -> Self {
        Self {
            schema_version: record.schema_version,
            run_id: record.run_id,
            project_id: record.project_id,
            note_filter: record.note_filter,
            cited_source_version_ids: record.cited_source_version_ids,
            prompt: record.prompt,
            due_count: record.due_count,
            created_at_unix_ms: record.created_at_unix_ms,
            vault_relative_path: record.vault_relative_path,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunListResponse {
    pub runs: Vec<ReviewRunResponse>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectReviewRunRequest {
    pub project_id: String,
    pub prompt: String,
    pub note_filter: Vec<String>,
    pub cited_source_version_ids: Vec<String>,
    pub due_count: u32,
}

pub fn create_project_review_run(
    vault_root: PathBuf,
    request_json: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let request: CreateProjectReviewRunRequest =
        serde_json::from_str(&request_json).map_err(|error| error.to_string())?;
    let now_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let registry = ReviewRunRegistry::new(&vault_root);
    let record = registry
        .create(
            &request.project_id,
            &request.prompt,
            &request.note_filter,
            &request.cited_source_version_ids,
            request.due_count,
            now_unix_ms,
        )
        .map_err(|error| error.to_string())?;
    json(ReviewRunResponse::from(record))
}

pub fn list_project_review_runs(
    vault_root: PathBuf,
    project_id: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let registry = ReviewRunRegistry::new(&vault_root);
    let runs = registry
        .list_for_project(&project_id)
        .map_err(|error| error.to_string())?;
    json(ReviewRunListResponse {
        runs: runs.into_iter().map(ReviewRunResponse::from).collect(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetricResponse {
    pub project_id: String,
    pub run_count: u32,
    pub due_count_total: u32,
    pub due_count_max: u32,
    pub last_run_unix_ms: i64,
    pub cited_source_version_total: u32,
    pub is_active_learner: bool,
    pub recent_run_count: u32,
}

impl From<local_knowledge_core::ProjectMetrics> for ProjectMetricResponse {
    fn from(metric: local_knowledge_core::ProjectMetrics) -> Self {
        Self {
            project_id: metric.project_id,
            run_count: metric.run_count,
            due_count_total: metric.due_count_total,
            due_count_max: metric.due_count_max,
            last_run_unix_ms: metric.last_run_unix_ms,
            cited_source_version_total: metric.cited_source_version_total,
            is_active_learner: metric.is_active_learner,
            recent_run_count: metric.recent_run_count,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsResponse {
    pub schema_version: u32,
    pub thresholds: MetricsThresholds,
    pub total_runs: u32,
    pub total_cited_source_versions: u32,
    pub projects: Vec<ProjectMetricResponse>,
    pub first_event_unix_ms: i64,
    pub last_event_unix_ms: i64,
}

impl From<LearningMetrics> for MetricsResponse {
    fn from(metrics: LearningMetrics) -> Self {
        Self {
            schema_version: metrics.schema_version,
            thresholds: metrics.thresholds,
            total_runs: metrics.total_runs,
            total_cited_source_versions: metrics.total_cited_source_versions,
            projects: metrics
                .projects
                .into_iter()
                .map(ProjectMetricResponse::from)
                .collect(),
            first_event_unix_ms: metrics.first_event_unix_ms,
            last_event_unix_ms: metrics.last_event_unix_ms,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListMetricsRequest {
    pub active_learner_min_runs: Option<u32>,
    pub consistency_window_ms: Option<i64>,
}

/// Compute transparent learning metrics for the current vault.
///
/// `request_json` lets the caller pass custom thresholds; when omitted
/// (`null` JSON), the default thresholds (`MetricsThresholds::default()`)
/// are used.
pub fn list_learning_metrics(vault_root: PathBuf, request_json: Option<String>) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let request: ListMetricsRequest = match request_json.as_deref() {
        Some(raw) if raw.trim() != "null" && !raw.trim().is_empty() => {
            serde_json::from_str(raw).map_err(|error| error.to_string())?
        }
        _ => ListMetricsRequest::default(),
    };
    let thresholds = MetricsThresholds {
        active_learner_min_runs: request.active_learner_min_runs.unwrap_or(1),
        consistency_window_ms: request
            .consistency_window_ms
            .unwrap_or(14 * 24 * 60 * 60 * 1000),
    };
    let registry = ReviewRunRegistry::new(&vault_root);
    let events = registry
        .list_learning_events()
        .map_err(|error| error.to_string())?;
    let now_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let metrics = derive_learning_metrics(&events, &thresholds, now_unix_ms);
    json(MetricsResponse::from(metrics))
}

/// Analyze a project and produce read-only action cards (PET companion).
/// Paid AI is never invoked; this is purely derived from existing vault data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCompanionResponse {
    pub schema_version: u32,
    pub project_id: String,
    pub as_of_unix_ms: i64,
    pub cards: Vec<ActionCardResponse>,
    pub category_counts: std::collections::HashMap<String, u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCardResponse {
    pub id: String,
    pub category: String,
    pub priority: String,
    pub title: String,
    pub body: String,
    pub anchor_type: Option<String>,
    pub anchor_id: Option<String>,
}

impl From<ActionCard> for ActionCardResponse {
    fn from(card: ActionCard) -> Self {
        let anchor_type = card.anchor_type.map(|at| match at {
            AnchorType::Note => "note".to_string(),
            AnchorType::SourceVersion => "sourceVersion".to_string(),
            AnchorType::ReviewRun => "reviewRun".to_string(),
            AnchorType::Project => "project".to_string(),
        });
        Self {
            id: card.id,
            category: card.category.as_str().to_string(),
            priority: match card.priority {
                CardPriority::High => "high".to_string(),
                CardPriority::Medium => "medium".to_string(),
                CardPriority::Low => "low".to_string(),
            },
            title: card.title,
            body: card.body,
            anchor_type,
            anchor_id: card.anchor_id,
        }
    }
}

impl From<PetCompanionOutput> for PetCompanionResponse {
    fn from(output: PetCompanionOutput) -> Self {
        Self {
            schema_version: output.schema_version,
            project_id: output.project_id,
            as_of_unix_ms: output.as_of_unix_ms,
            cards: output.cards.into_iter().map(ActionCardResponse::from).collect(),
            category_counts: output.category_counts,
        }
    }
}

pub fn analyze_project_pet(
    vault_root: PathBuf,
    project_id: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let layout = VaultLayout::new(&vault_root);
    // Determinism anchor: callers supply `now` from the frontend (or fall back
    // to wall-clock time at the Tauri boundary, where determinism is no longer
    // required because the response is consumed by a single live UI session).
    let as_of_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let output = analyze_pet_project(&project_id, &layout, as_of_unix_ms)
        .map_err(|e| e.to_string())?;
    json(PetCompanionResponse::from(output))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedNodeResponse {
    pub node_id: String,
    pub title: String,
    pub summary: String,
    pub body_markdown: String,
    pub tags: Vec<String>,
    pub source_anchor: String,
    pub relation_type: String,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedNodeListResponse {
    pub nodes: Vec<PersistedNodeResponse>,
}

impl From<PersistedNode> for PersistedNodeResponse {
    fn from(node: PersistedNode) -> Self {
        Self {
            node_id: node.node_id,
            title: node.title,
            summary: node.summary,
            body_markdown: node.body_markdown,
            tags: node.tags,
            source_anchor: node.source_anchor,
            relation_type: node.relation_type,
            vault_relative_path: node.vault_relative_path,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLibraryResponse {
    pub sources: Vec<SourceResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagAnalysisResponse {
    pub query: String,
    pub source_name: String,
    pub sources: Vec<SourceResponse>,
    pub chunks: Vec<RetrievedChunkResponse>,
    pub nodes: Vec<DraftNodeResponse>,
    pub edges: Vec<GraphEdgeResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDraftResponse {
    pub source_name: String,
    pub nodes: Vec<DraftNodeResponse>,
    pub edges: Vec<GraphEdgeResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResponse {
    pub source_id: String,
    pub source_name: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub chunk_count: usize,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedChunkResponse {
    pub chunk_id: String,
    pub source_id: String,
    pub source_name: String,
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftNodeResponse {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub confidence: u8,
    pub relation_type: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeResponse {
    pub id: String,
    pub from: String,
    pub to: String,
    pub label: String,
}

pub fn initialize_vault(root: PathBuf) -> io::Result<PathBuf> {
    validate_vault_root(&root).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
    let layout = VaultLayout::new(root);
    layout.ensure_dirs()?;
    Ok(layout.root().to_path_buf())
}

pub fn generate_knowledge_draft(prompt: String) -> Result<String, String> {
    let draft = generate_core_knowledge_draft(&prompt).map_err(|error| error.to_string())?;
    json(KnowledgeDraftResponse::from(draft))
}

pub fn generate_knowledge_draft_from_source(
    source_name: String,
    content: String,
) -> Result<String, String> {
    let draft = generate_core_knowledge_draft_from_source(&source_name, &content)
        .map_err(|error| error.to_string())?;
    json(KnowledgeDraftResponse::from(draft))
}

pub fn ingest_sources(vault_root: PathBuf, sources_json: String) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let requests: Vec<SourceUploadRequest> =
        serde_json::from_str(&sources_json).map_err(|error| error.to_string())?;
    let uploads: Vec<SourceUpload> = requests
        .into_iter()
        .map(|request| SourceUpload {
            source_name: request.source_name,
            content: request.content,
        })
        .collect();

    let sources =
        ingest_markdown_sources(vault_root, &uploads).map_err(|error| error.to_string())?;
    json(SourceLibraryResponse {
        sources: sources.into_iter().map(SourceResponse::from).collect(),
    })
}

pub fn analyze_sources(vault_root: PathBuf, query: String) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let analysis =
        analyze_indexed_sources(vault_root, &query).map_err(|error| error.to_string())?;
    json(RagAnalysisResponse::from(analysis))
}

pub fn save_note(
    vault_root: PathBuf,
    title: String,
    body_markdown: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let note = save_core_learning_note(vault_root, &title, &body_markdown)
        .map_err(|error| error.to_string())?;
    json(LearningNoteResponse::from(note))
}

pub fn list_notes(vault_root: PathBuf) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let notes =
        local_knowledge_core::list_learning_notes(vault_root).map_err(|error| error.to_string())?;
    json(LearningNoteListResponse {
        notes: notes.into_iter().map(LearningNoteResponse::from).collect(),
    })
}

// ── Project vault commands ───────────────────────────────────────────────

pub fn create_project(vault_root: PathBuf, title: String) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let snapshot = vault
        .create_project(&title)
        .map_err(|error| error.to_string())?;
    json(ProjectSnapshotResponse::from(snapshot))
}

pub fn list_projects(vault_root: PathBuf) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let projects = vault.list_projects().map_err(|error| error.to_string())?;
    json(ProjectListResponse {
        projects: projects
            .into_iter()
            .map(ProjectManifestResponse::from)
            .collect(),
    })
}

pub fn get_project(vault_root: PathBuf, project_id: String) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let project = vault
        .load_project(&project_id)
        .map_err(|error| error.to_string())?;
    json(ProjectManifestResponse::from(project))
}

pub fn rename_project(
    vault_root: PathBuf,
    project_id: String,
    title: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let project = vault
        .rename_project(&project_id, &title)
        .map_err(|error| error.to_string())?;
    json(ProjectManifestResponse::from(project))
}

pub fn create_project_note(
    vault_root: PathBuf,
    project_id: String,
    title: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let note = vault
        .create_note(&project_id, &title)
        .map_err(|error| error.to_string())?;
    json(ProjectNoteResponse::from(note))
}

pub fn save_project_note(
    vault_root: PathBuf,
    project_id: String,
    note_id: String,
    title: String,
    body_markdown: String,
    tags_json: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).map_err(|error| error.to_string())?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let note = vault
        .save_note(&project_id, &note_id, &title, &body_markdown, &tags)
        .map_err(|error| error.to_string())?;
    json(ProjectNoteResponse::from(note))
}

pub fn list_project_notes(vault_root: PathBuf, project_id: String) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let notes = vault
        .list_notes(&project_id)
        .map_err(|error| error.to_string())?;
    json(ProjectNoteListResponse {
        notes: notes.into_iter().map(ProjectNoteResponse::from).collect(),
    })
}

pub fn delete_project_note(
    vault_root: PathBuf,
    project_id: String,
    note_id: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    vault
        .delete_note(&project_id, &note_id)
        .map_err(|error| error.to_string())?;
    json(serde_json::json!({ "deleted": true }))
}

pub fn migrate_legacy_workspace(vault_root: PathBuf) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let vault = ProjectVault::initialize(vault_root).map_err(|error| error.to_string())?;
    let report = vault
        .migrate_legacy_notes()
        .map_err(|error| error.to_string())?;
    json(LegacyMigrationResponse::from(report))
}

pub fn save_ai_suggestions(
    vault_root: PathBuf,
    suggestions_json: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let requests: Vec<AiSuggestionRequest> =
        serde_json::from_str(&suggestions_json).map_err(|error| error.to_string())?;
    let suggestions: Vec<NewAiSuggestion> = requests
        .into_iter()
        .map(|request| NewAiSuggestion {
            suggestion_id: request.suggestion_id,
            from_node_id: request.from_node_id,
            to_node_id: request.to_node_id,
            relation_kind: request.relation_kind,
            rationale: request.rationale,
            confidence: request.confidence,
        })
        .collect();
    let suggestions =
        save_core_ai_suggestions(vault_root, &suggestions).map_err(|error| error.to_string())?;
    json(AiSuggestionListResponse {
        suggestions: suggestions
            .into_iter()
            .map(AiSuggestionResponse::from)
            .collect(),
    })
}

pub fn list_ai_suggestions(vault_root: PathBuf) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let suggestions = list_core_ai_suggestions(vault_root).map_err(|error| error.to_string())?;
    json(AiSuggestionListResponse {
        suggestions: suggestions
            .into_iter()
            .map(AiSuggestionResponse::from)
            .collect(),
    })
}

pub fn record_suggestion_decision(
    vault_root: PathBuf,
    suggestion_id: String,
    status: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let status = SuggestionStatus::parse(&status).map_err(|error| error.to_string())?;
    let suggestion = record_core_suggestion_decision(vault_root, &suggestion_id, status)
        .map_err(|error| error.to_string())?;
    json(AiSuggestionResponse::from(suggestion))
}

// ── Node Persistence Commands ────────────────────────────────────────────

/// Persist an approved node into the vault.
pub fn persist_approved_node(
    vault_root: PathBuf,
    node_id: String,
    title: String,
    summary: String,
    body_markdown: String,
    tags_json: String,
    source_anchor: String,
    relation_type: String,
) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).map_err(|e| e.to_string())?;
    let node = local_knowledge_core::persist_node(
        vault_root, &node_id, &title, &summary, &body_markdown,
        &tags, &source_anchor, &relation_type,
    ).map_err(|e| e.to_string())?;
    json(PersistedNodeResponse::from(node))
}

/// List all persisted nodes in the vault.
pub fn list_persisted_nodes_cmd(vault_root: PathBuf) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    let nodes = local_knowledge_core::list_persisted_nodes(vault_root)
        .map_err(|e| e.to_string())?;
    json(PersistedNodeListResponse {
        nodes: nodes.into_iter().map(PersistedNodeResponse::from).collect(),
    })
}

/// Delete a persisted node from the vault.
pub fn delete_persisted_node_cmd(vault_root: PathBuf, node_id: String) -> Result<String, String> {
    validate_vault_root(&vault_root)?;
    local_knowledge_core::delete_persisted_node(vault_root, &node_id)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"success": true}).to_string())
}

// ── LLM-powered commands ──────────────────────────────────────────────────

/// Generate knowledge nodes using LLM. Falls back to deterministic draft if no API key.
pub async fn generate_knowledge_draft_with_llm(
    config_json: String,
    prompt: String,
    source_context: String,
) -> Result<String, String> {
    let config: LlmConfig =
        serde_json::from_str::<LlmConfigRequest>(&config_json)
            .map_err(|e| e.to_string())?
            .into();

    if config.api_key.trim().is_empty() {
        // Fallback to deterministic draft
        let draft = generate_core_knowledge_draft(&prompt).map_err(|e| e.to_string())?;
        return json(KnowledgeDraftResponse::from(draft));
    }

    let response = local_knowledge_core::generate_nodes_with_llm(&config, &prompt, &source_context)
        .await
        .map_err(|e| e.to_string())?;

    let llm_draft: local_knowledge_core::LlmDraftResponse =
        serde_json::from_str(&response).map_err(|_e| {
            tracing::warn!("LLM returned unparseable response at generate_nodes_with_llm");
            "LLM returned invalid JSON. Try a different model or provider.".to_string()
        })?;

    let nodes: Vec<DraftNodeResponse> = llm_draft
        .nodes
        .into_iter()
        .enumerate()
        .map(|(i, node)| DraftNodeResponse {
            id: format!("llm-node-{}", i + 1),
            title: node.title,
            summary: node.summary,
            tags: node.tags,
            confidence: 85,
            relation_type: node.relation_type,
            source: format!("llm-generation-{}", i + 1),
        })
        .collect();

    let edges: Vec<GraphEdgeResponse> = llm_draft
        .edges
        .into_iter()
        .filter_map(|edge| {
            let from_id = nodes.get(edge.from)?.id.clone();
            let to_id = nodes.get(edge.to)?.id.clone();
            Some(GraphEdgeResponse {
                id: format!("llm-edge-{}-{}", edge.from, edge.to),
                from: from_id,
                to: to_id,
                label: edge.label,
            })
        })
        .collect();

    json(KnowledgeDraftResponse {
        source_name: "llm-draft.md".to_string(),
        nodes,
        edges,
    })
}

/// Answer a review question using LLM with source chunks as context.
pub async fn answer_review_question_with_llm(
    config_json: String,
    question: String,
    source_context: String,
) -> Result<String, String> {
    let config: LlmConfig =
        serde_json::from_str::<LlmConfigRequest>(&config_json)
            .map_err(|e| e.to_string())?
            .into();

    if config.api_key.trim().is_empty() {
        // Fallback: return first source chunk as-is
        return Ok(serde_json::json!({
            "answer": "No LLM configured. Please set up your API key in Settings > LLM Configuration.",
            "citations": []
        })
        .to_string());
    }

    let answer = local_knowledge_core::answer_review_question(&config, &question, &source_context)
        .await
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "answer": answer,
        "citations": []
    })
    .to_string())
}

/// Generate relation suggestions using LLM.
pub async fn suggest_relations_with_llm(
    config_json: String,
    nodes_json: String,
) -> Result<String, String> {
    let config: LlmConfig =
        serde_json::from_str::<LlmConfigRequest>(&config_json)
            .map_err(|e| e.to_string())?
            .into();

    if config.api_key.trim().is_empty() {
        return Ok(serde_json::json!({ "suggestions": [] }).to_string());
    }

    let response =
        local_knowledge_core::suggest_relations_with_llm(&config, &nodes_json)
            .await
            .map_err(|e| e.to_string())?;

    let suggestions: local_knowledge_core::LlmSuggestionResponse =
        serde_json::from_str(&response).map_err(|_e| {
            tracing::warn!("LLM returned unparseable response at suggest_relations_with_llm");
            "LLM returned invalid JSON for suggestions.".to_string()
        })?;

    json(suggestions.suggestions)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfigRequest {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: String,
}

impl From<LlmConfigRequest> for LlmConfig {
    fn from(req: LlmConfigRequest) -> Self {
        Self {
            provider: req.provider,
            model: req.model,
            api_key: req.api_key,
            base_url: req.base_url,
        }
    }
}

/// Validate that vault_root resolves inside an expected vault location.
/// Absolute paths, traversal paths, and paths outside the vault are rejected.
fn validate_vault_root(root: &Path) -> Result<(), String> {
    let root_os = root.as_os_str();
    if root_os.is_empty() {
        return Err("vault_root cannot be empty".into());
    }
    if root.is_absolute() {
        #[cfg(not(test))]
        return Err(format!(
            "vault_root must be a relative path, not an absolute path: {}",
            root.display()
        ));
        #[cfg(test)]
        return Ok(());
    }
    if !local_knowledge_core::is_safe_relative_path(root) {
        return Err(format!(
            "vault_root contains invalid path components: {}",
            root.display()
        ));
    }
    Ok(())
}

fn json<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

impl From<KnowledgeDraft> for KnowledgeDraftResponse {
    fn from(draft: KnowledgeDraft) -> Self {
        Self {
            source_name: draft.source_name,
            nodes: draft
                .nodes
                .into_iter()
                .map(DraftNodeResponse::from)
                .collect(),
            edges: draft
                .edges
                .into_iter()
                .map(GraphEdgeResponse::from)
                .collect(),
        }
    }
}

impl From<RagAnalysis> for RagAnalysisResponse {
    fn from(analysis: RagAnalysis) -> Self {
        Self {
            query: analysis.query,
            source_name: analysis.draft.source_name,
            sources: analysis
                .sources
                .into_iter()
                .map(SourceResponse::from)
                .collect(),
            chunks: analysis
                .chunks
                .into_iter()
                .map(RetrievedChunkResponse::from)
                .collect(),
            nodes: analysis
                .draft
                .nodes
                .into_iter()
                .map(DraftNodeResponse::from)
                .collect(),
            edges: analysis
                .draft
                .edges
                .into_iter()
                .map(GraphEdgeResponse::from)
                .collect(),
        }
    }
}

impl From<IngestedSource> for SourceResponse {
    fn from(source: IngestedSource) -> Self {
        Self {
            source_id: source.source_id,
            source_name: source.source_name,
            sha256: source.sha256,
            size_bytes: source.size_bytes,
            chunk_count: source.chunk_count,
            vault_relative_path: source.vault_relative_path,
        }
    }
}

impl From<RetrievedChunk> for RetrievedChunkResponse {
    fn from(chunk: RetrievedChunk) -> Self {
        Self {
            chunk_id: chunk.chunk_id,
            source_id: chunk.source_id,
            source_name: chunk.source_name,
            start_line: chunk.start_line,
            end_line: chunk.end_line,
            text: chunk.text,
            score: chunk.score,
        }
    }
}

impl From<LearningNote> for LearningNoteResponse {
    fn from(note: LearningNote) -> Self {
        Self {
            note_id: note.note_id,
            title: note.title,
            body_markdown: note.body_markdown,
            updated_at_unix_ms: note.updated_at_unix_ms,
        }
    }
}

impl From<AiSuggestion> for AiSuggestionResponse {
    fn from(suggestion: AiSuggestion) -> Self {
        Self {
            suggestion_id: suggestion.suggestion_id,
            from_node_id: suggestion.from_node_id,
            to_node_id: suggestion.to_node_id,
            relation_kind: suggestion.relation_kind,
            rationale: suggestion.rationale,
            confidence: suggestion.confidence,
            status: suggestion.status.as_str().to_string(),
            created_at_unix_ms: suggestion.created_at_unix_ms,
            decided_at_unix_ms: suggestion.decided_at_unix_ms,
        }
    }
}

impl From<DraftNode> for DraftNodeResponse {
    fn from(node: DraftNode) -> Self {
        Self {
            id: node.id,
            title: node.title,
            summary: node.summary,
            tags: node.tags,
            confidence: node.confidence,
            relation_type: node.relation_type.as_label().to_string(),
            source: node.source,
        }
    }
}

impl From<DraftEdge> for GraphEdgeResponse {
    fn from(edge: DraftEdge) -> Self {
        Self {
            id: edge.id,
            from: edge.from,
            to: edge.to,
            label: edge.label,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn returns_json_for_draft() {
        let json = generate_knowledge_draft("Rust commands return local node drafts.".to_string())
            .expect("draft should serialize");

        assert!(json.contains("\"sourceName\":\"prompt-draft.md\""));
        assert!(json.contains("\"nodes\":["));
        assert!(json.contains("\"edges\":["));
    }

    #[test]
    fn returns_json_for_named_source_draft() {
        let json = generate_knowledge_draft_from_source(
            "memory-notes.md".to_string(),
            "Memory improves when recall is active.".to_string(),
        )
        .expect("named source draft should serialize");

        assert!(json.contains("\"sourceName\":\"memory-notes.md\""));
        assert!(json.contains("\"source\":\"memory-notes.md:"));
    }

    #[test]
    fn ingests_and_analyzes_sources() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-command-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        let sources = serde_json::to_string(&vec![
            SourceUploadRequest {
                source_name: "memory.md".to_string(),
                content: "Retrieval practice strengthens recall.".to_string(),
            },
            SourceUploadRequest {
                source_name: "systems.md".to_string(),
                content: "Schedulers choose which process runs next.".to_string(),
            },
        ])
        .expect("source json should serialize");

        let library = ingest_sources(root.clone(), sources).expect("ingest should work");
        assert!(library.contains("\"sources\":["));
        assert!(library.contains("\"chunkCount\":1"));

        let analysis = analyze_sources(root.clone(), "retrieval recall".to_string())
            .expect("analysis should work");
        assert!(analysis.contains("\"chunks\":["));
        assert!(analysis.contains("\"sourceName\":\"rag-analysis.md\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saves_note_and_records_suggestion_decision() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-command-workspace-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));

        let note = save_note(
            root.clone(),
            "Roadmap node".to_string(),
            "A graph node should preserve source-backed review context.".to_string(),
        )
        .expect("note should save");
        assert!(note.contains("\"noteId\":\"note_"));

        let suggestions_json = serde_json::to_string(&vec![AiSuggestionRequest {
            suggestion_id: "suggestion_roadmap".to_string(),
            from_node_id: "draft_node".to_string(),
            to_node_id: "vault_node".to_string(),
            relation_kind: "supports".to_string(),
            rationale: "Both nodes describe graph navigation.".to_string(),
            confidence: 81,
        }])
        .expect("suggestion json should serialize");
        let saved =
            save_ai_suggestions(root.clone(), suggestions_json).expect("suggestion should save");
        assert!(saved.contains("\"status\":\"pending\""));

        let decided = record_suggestion_decision(
            root.clone(),
            "suggestion_roadmap".to_string(),
            "approved".to_string(),
        )
        .expect("suggestion should approve");
        assert!(decided.contains("\"status\":\"approved\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_commands_round_trip_canonical_note_contract() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-project-command-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));

        let created = create_project(root.clone(), "Study Systems".to_string())
            .expect("project should create");
        let created: serde_json::Value =
            serde_json::from_str(&created).expect("project response should parse");
        let project_id = created["project"]["projectId"]
            .as_str()
            .expect("project id should exist")
            .to_string();
        let note_id = created["defaultNote"]["noteId"]
            .as_str()
            .expect("default note id should exist")
            .to_string();

        let saved = save_project_note(
            root.clone(),
            project_id.clone(),
            note_id.clone(),
            "Canonical Markdown".to_string(),
            "# Durable\n\nThe vault is the product.".to_string(),
            "[\" Rust \", \"rust\", \"FTS\"]".to_string(),
        )
        .expect("project note should save");
        assert!(saved.contains("\"tags\":[\"rust\",\"fts\"]"));
        assert!(saved.contains(&format!("projects/{project_id}/notes/{note_id}.md")));

        let projects = list_projects(root.clone()).expect("projects should list");
        assert!(projects.contains(&project_id));
        let notes = list_project_notes(root.clone(), project_id).expect("notes should list");
        assert!(notes.contains("The vault is the product."));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_command_reports_idempotent_status() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-project-migration-command-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        save_note(
            root.clone(),
            "Legacy".to_string(),
            "Preserve this note.".to_string(),
        )
        .expect("legacy note should save");

        let first = migrate_legacy_workspace(root.clone()).expect("migration should succeed");
        let second = migrate_legacy_workspace(root.clone()).expect("migration should repeat");
        assert!(first.contains("\"status\":\"migrated\""));
        assert!(first.contains("\"migratedNoteCount\":1"));
        assert!(second.contains("\"status\":\"alreadyCompleted\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persists_approved_node_and_lists_it() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-persist-cmd-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));

        let json = persist_approved_node(
            root.clone(),
            "node_cmd_001".to_string(),
            "Command Bridge".to_string(),
            "Wires Tauri commands to core persistence.".to_string(),
            "The command bridge delegates to core's persist_node function.".to_string(),
            "[\"rust\", \"tauri\"]".to_string(),
            "architecture.md:1-10".to_string(),
            "Supports".to_string(),
        )
        .expect("persist should succeed");
        assert!(json.contains("\"nodeId\":\"node_cmd_001\""));
        assert!(json.contains("\"title\":\"Command Bridge\""));
        assert!(json.contains("\"tags\":[\"rust\",\"tauri\"]"));
        assert!(json.contains("\"relationType\":\"Supports\""));
        assert!(json.contains("\"vaultRelativePath\":\"nodes/"));

        let list_json = list_persisted_nodes_cmd(root.clone())
            .expect("list should succeed");
        assert!(list_json.contains("\"nodes\":["));
        assert!(list_json.contains("\"nodeId\":\"node_cmd_001\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_persisted_node_via_command() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-delete-cmd-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));

        // First persist a node
        persist_approved_node(
            root.clone(),
            "node_del_cmd".to_string(),
            "Delete Me".to_string(),
            "Will be removed".to_string(),
            "Content body".to_string(),
            "[]".to_string(),
            "src.md:1".to_string(),
            "Source".to_string(),
        )
        .expect("persist should succeed");

        // Verify it exists
        let list_json = list_persisted_nodes_cmd(root.clone()).expect("list should succeed");
        assert!(list_json.contains("\"nodeId\":\"node_del_cmd\""));

        // Delete it
        let delete_json = delete_persisted_node_cmd(root.clone(), "node_del_cmd".to_string())
            .expect("delete should succeed");
        assert!(delete_json.contains("\"success\":true"));

        // Verify it's gone
        let list_json2 = list_persisted_nodes_cmd(root.clone()).expect("list should succeed");
        assert!(!list_json2.contains("\"nodeId\":\"node_del_cmd\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persist_rejects_empty_title() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-reject-cmd-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));

        let result = persist_approved_node(
            root.clone(),
            "id".to_string(),
            "".to_string(),
            "summary".to_string(),
            "body".to_string(),
            "[]".to_string(),
            "src.md:1".to_string(),
            "Source".to_string(),
        );
        assert!(result.is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validate_vault_root_rejects_traversal() {
        use std::path::Path;
        let result = ingest_sources(
            Path::new("../outside-vault").to_path_buf(),
            serde_json::to_string::<Vec<SourceUploadRequest>>(&vec![]).unwrap(),
        );
        assert!(result.is_err(), "traversal vault_root should be rejected");
    }

    #[test]
    fn review_run_command_round_trips_with_metrics() {
        let root = std::env::temp_dir().join(format!(
            "learn-alone-review-run-cmd-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        let created = create_project(root.clone(), "Slice 4 Review".to_string())
            .expect("project should create");
        let created: serde_json::Value =
            serde_json::from_str(&created).expect("project response should parse");
        let project_id = created["project"]["projectId"]
            .as_str()
            .expect("project id")
            .to_string();

        let request = serde_json::json!({
            "projectId": project_id,
            "prompt": "What are the implications of FSRS scheduling?",
            "noteFilter": [],
            "citedSourceVersionIds": [],
            "dueCount": 4u32
        });
        let payload = create_project_review_run(
            root.clone(),
            serde_json::to_string(&request).expect("request should serialize"),
        )
        .expect("create_project_review_run should succeed");
        let parsed: serde_json::Value = serde_json::from_str(&payload).expect("run json parse");
        assert_eq!(parsed["projectId"], project_id);
        assert_eq!(parsed["dueCount"], 4);

        let listed = list_project_review_runs(root.clone(), project_id.clone())
            .expect("list_project_review_runs should succeed");
        assert!(listed.contains("\"runs\":["));

        // metrics: defaults — one run counted, no cited source versions.
        let metrics = list_learning_metrics(root.clone(), None)
            .expect("list_learning_metrics should succeed");
        assert!(metrics.contains("\"totalRuns\":1"));
        assert!(metrics.contains("\"thresholds\":"));
        assert!(metrics.contains("\"isActiveLearner\":true"));

        // metrics with custom threshold that excludes 1 run.
        let req = serde_json::json!({
            "activeLearnerMinRuns": 5u32,
            "consistencyWindowMs": 86_400_000i64
        });
        let metrics = list_learning_metrics(
            root.clone(),
            Some(serde_json::to_string(&req).expect("metric req serialize")),
        )
        .expect("metrics with custom thresholds should succeed");
        assert!(metrics.contains("\"isActiveLearner\":false"));

        let _ = fs::remove_dir_all(root);
    }
}
