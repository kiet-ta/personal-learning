pub mod domain;
pub mod draft;
pub(crate) mod atomic_write;
pub mod llm;
pub mod node_persistence;
pub mod project_vault;
pub mod rag;
pub mod review;
pub mod source_versions;
pub mod vault;
pub mod worker_bridge;
pub mod workspace;

pub use domain::{
    Edge, EdgeKind, Modality, Node, NodeVersion, SourceAnchor, SourceAsset,
};
pub use draft::{
    generate_knowledge_draft, generate_knowledge_draft_from_source, DraftEdge, DraftError,
    DraftNode, DraftRelationType, DraftSourceChunk, KnowledgeDraft,
};
pub use llm::{
    answer_review_question, call_llm, generate_nodes_with_llm, suggest_relations_with_llm,
    LlmConfig, LlmDraftEdge, LlmDraftNode, LlmDraftResponse, LlmError, LlmSuggestion,
    LlmSuggestionResponse, SYSTEM_PROMPT_GENERATE_NODES, SYSTEM_PROMPT_REVIEW,
    SYSTEM_PROMPT_SUGGEST_RELATIONS,
};
pub use node_persistence::{
    delete_persisted_node, list_persisted_nodes, persist_node, NodePersistenceError, PersistedNode,
};
pub use project_vault::{
    LegacyMigrationReport, LegacyMigrationStatus, ProjectManifest, ProjectNote, ProjectSnapshot,
    ProjectVault, ProjectVaultError, IMPORTED_PROJECT_ID, PROJECT_SCHEMA_VERSION,
};
pub use source_versions::{
    build_evidence_locator, EvidenceLocator, SourceVersion, SourceVersionError, SourceVersionKind,
    SourceVersionRegistry,
};
pub use rag::{
    analyze_indexed_sources, ingest_markdown_sources, list_indexed_sources, search_indexed_chunks,
    IngestedSource, RagAnalysis, RagError, RetrievedChunk, SourceUpload,
};
pub use review::{ReviewScheduler, ReviewItem, ReviewEvent, ReviewGrade, ReviewError};
pub use vault::{is_safe_relative_path, VaultLayout};
pub use worker_bridge::{run_document_worker, WorkerInput, WorkerOutput, WorkerBridgeError};
pub use workspace::{
    list_ai_suggestions, list_learning_notes, record_suggestion_decision, save_ai_suggestions,
    save_learning_note, AiSuggestion, LearningNote, NewAiSuggestion, SuggestionStatus,
    WorkspaceError,
};
