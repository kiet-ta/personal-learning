pub mod domain;
pub mod draft;
pub mod rag;
pub mod vault;
pub mod workspace;

pub use domain::{
    Edge, EdgeKind, Modality, Node, NodeVersion, ReviewEvent, ReviewGrade, ReviewItem,
    SourceAnchor, SourceAsset,
};
pub use draft::{
    generate_knowledge_draft, generate_knowledge_draft_from_source, DraftEdge, DraftError,
    DraftNode, DraftRelationType, DraftSourceChunk, KnowledgeDraft,
};
pub use rag::{
    analyze_indexed_sources, ingest_markdown_sources, list_indexed_sources, search_indexed_chunks,
    IngestedSource, RagAnalysis, RagError, RetrievedChunk, SourceUpload,
};
pub use vault::{is_safe_relative_path, VaultLayout};
pub use workspace::{
    list_ai_suggestions, list_learning_notes, record_suggestion_decision, save_ai_suggestions,
    save_learning_note, AiSuggestion, LearningNote, NewAiSuggestion, SuggestionStatus,
    WorkspaceError,
};
