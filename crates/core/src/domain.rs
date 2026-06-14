#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Modality {
    Pdf,
    Text,
    Markdown,
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceAsset {
    pub asset_id: String,
    pub sha256: String,
    pub filename: String,
    pub mime_type: String,
    pub modality: Modality,
    pub size_bytes: u64,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceAnchor {
    pub source_file: String,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
    pub start_offset: Option<u64>,
    pub end_offset: Option<u64>,
    pub page: Option<u32>,
    pub section_path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub node_id: String,
    pub current_version_id: String,
    pub title: String,
    pub source_asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeVersion {
    pub version_id: String,
    pub node_id: String,
    pub body_markdown: String,
    pub summary: String,
    pub source_anchor: SourceAnchor,
    pub node_reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EdgeKind {
    ParentChild,
    Next,
    SameSource,
    Mentions,
    SemanticNear,
    Prerequisite,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge {
    pub edge_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub kind: EdgeKind,
    pub confidence_basis: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewItem {
    pub review_item_id: String,
    pub node_id: String,
    pub prompt: String,
    pub due_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewGrade {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewEvent {
    pub review_event_id: String,
    pub review_item_id: String,
    pub grade: ReviewGrade,
    pub latency_ms: u32,
    pub reviewed_at_unix_ms: i64,
    pub device_id: String,
}
