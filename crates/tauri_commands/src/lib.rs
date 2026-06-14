use std::io;
use std::path::PathBuf;

use local_knowledge_core::{
    analyze_indexed_sources, generate_knowledge_draft as generate_core_knowledge_draft,
    generate_knowledge_draft_from_source as generate_core_knowledge_draft_from_source,
    ingest_markdown_sources, DraftEdge, DraftNode, IngestedSource, KnowledgeDraft, RagAnalysis,
    RetrievedChunk, SourceUpload, VaultLayout,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUploadRequest {
    pub source_name: String,
    pub content: String,
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
    let analysis = analyze_indexed_sources(vault_root, &query).map_err(|error| error.to_string())?;
    json(RagAnalysisResponse::from(analysis))
}

fn json<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

impl From<KnowledgeDraft> for KnowledgeDraftResponse {
    fn from(draft: KnowledgeDraft) -> Self {
        Self {
            source_name: draft.source_name,
            nodes: draft.nodes.into_iter().map(DraftNodeResponse::from).collect(),
            edges: draft.edges.into_iter().map(GraphEdgeResponse::from).collect(),
        }
    }
}

impl From<RagAnalysis> for RagAnalysisResponse {
    fn from(analysis: RagAnalysis) -> Self {
        Self {
            query: analysis.query,
            source_name: analysis.draft.source_name,
            sources: analysis.sources.into_iter().map(SourceResponse::from).collect(),
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
}
