use std::error::Error;
use std::fmt;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

use crate::draft::{
    generate_knowledge_draft_from_source_chunks, DraftError, DraftSourceChunk, KnowledgeDraft,
};
use crate::VaultLayout;

const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_SOURCES_PER_BATCH: usize = 40;
const MAX_CHUNKS_PER_SOURCE: usize = 400;
const TARGET_CHUNK_CHARS: usize = 1_400;
const MIN_CHUNK_CHARS: usize = 420;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceUpload {
    pub source_name: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IngestedSource {
    pub source_id: String,
    pub source_name: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub chunk_count: usize,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetrievedChunk {
    pub chunk_id: String,
    pub source_id: String,
    pub source_name: String,
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RagAnalysis {
    pub query: String,
    pub sources: Vec<IngestedSource>,
    pub chunks: Vec<RetrievedChunk>,
    pub draft: KnowledgeDraft,
}

#[derive(Debug)]
pub enum RagError {
    EmptySourceBatch,
    TooManySources { actual: usize, max: usize },
    EmptySource { source_name: String },
    SourceTooLarge {
        source_name: String,
        actual_bytes: usize,
        max_bytes: usize,
    },
    InvalidSourceName(String),
    UnsupportedSourceType(String),
    NoIndexedChunks,
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Draft(DraftError),
}

impl fmt::Display for RagError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptySourceBatch => write!(formatter, "No sources were provided."),
            Self::TooManySources { actual, max } => {
                write!(formatter, "Received {actual} sources, exceeding the {max} source limit.")
            }
            Self::EmptySource { source_name } => write!(formatter, "{source_name} is empty."),
            Self::SourceTooLarge {
                source_name,
                actual_bytes,
                max_bytes,
            } => write!(
                formatter,
                "{source_name} is {actual_bytes} bytes, exceeding the {max_bytes} byte limit."
            ),
            Self::InvalidSourceName(source_name) => {
                write!(formatter, "Source filename is invalid: {source_name}.")
            }
            Self::UnsupportedSourceType(source_name) => {
                write!(formatter, "Unsupported source type: {source_name}.")
            }
            Self::NoIndexedChunks => write!(formatter, "No indexed chunks are available."),
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Sqlite(error) => write!(formatter, "{error}"),
            Self::Draft(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for RagError {}

impl From<std::io::Error> for RagError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for RagError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<DraftError> for RagError {
    fn from(error: DraftError) -> Self {
        Self::Draft(error)
    }
}

#[derive(Debug, Clone)]
struct SourceChunk {
    chunk_id: String,
    source_id: String,
    source_name: String,
    chunk_index: usize,
    start_line: u32,
    end_line: u32,
    text: String,
}

pub fn ingest_markdown_sources(
    vault_root: impl AsRef<Path>,
    sources: &[SourceUpload],
) -> Result<Vec<IngestedSource>, RagError> {
    if sources.is_empty() {
        return Err(RagError::EmptySourceBatch);
    }
    if sources.len() > MAX_SOURCES_PER_BATCH {
        return Err(RagError::TooManySources {
            actual: sources.len(),
            max: MAX_SOURCES_PER_BATCH,
        });
    }

    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let mut connection = open_index(&layout)?;
    ensure_schema(&connection)?;

    let mut ingested = Vec::with_capacity(sources.len());
    for source in sources {
        ingested.push(ingest_one_source(&layout, &mut connection, source)?);
    }

    Ok(ingested)
}

pub fn list_indexed_sources(
    vault_root: impl AsRef<Path>,
) -> Result<Vec<IngestedSource>, RagError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_index(&layout)?;
    ensure_schema(&connection)?;
    list_sources(&connection)
}

pub fn search_indexed_chunks(
    vault_root: impl AsRef<Path>,
    query: &str,
    limit: usize,
) -> Result<Vec<RetrievedChunk>, RagError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_index(&layout)?;
    ensure_schema(&connection)?;
    search_chunks(&connection, query, limit)
}

pub fn analyze_indexed_sources(
    vault_root: impl AsRef<Path>,
    query: &str,
) -> Result<RagAnalysis, RagError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_index(&layout)?;
    ensure_schema(&connection)?;

    let sources = list_sources(&connection)?;
    let chunks = search_chunks(&connection, query, 8)?;
    if chunks.is_empty() {
        return Err(RagError::NoIndexedChunks);
    }

    let draft_chunks: Vec<DraftSourceChunk> = chunks
        .iter()
        .map(|chunk| DraftSourceChunk {
            source_name: chunk.source_name.clone(),
            text: chunk.text.clone(),
            start_line: chunk.start_line,
            end_line: chunk.end_line,
        })
        .collect();
    let draft = generate_knowledge_draft_from_source_chunks(&draft_chunks)?;

    Ok(RagAnalysis {
        query: query.trim().to_string(),
        sources,
        chunks,
        draft,
    })
}

fn open_index(layout: &VaultLayout) -> Result<Connection, RagError> {
    Ok(Connection::open(layout.index_path())?)
}

fn ensure_schema(connection: &Connection) -> Result<(), RagError> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS source_assets (
            source_id TEXT PRIMARY KEY,
            source_name TEXT NOT NULL,
            sha256 TEXT NOT NULL UNIQUE,
            size_bytes INTEGER NOT NULL,
            vault_relative_path TEXT NOT NULL,
            created_at_unix_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_chunks (
            chunk_id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            text TEXT NOT NULL,
            FOREIGN KEY(source_id) REFERENCES source_assets(source_id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts
        USING fts5(chunk_id UNINDEXED, source_id UNINDEXED, source_name UNINDEXED, text);
        ",
    )?;
    Ok(())
}

fn ingest_one_source(
    layout: &VaultLayout,
    connection: &mut Connection,
    source: &SourceUpload,
) -> Result<IngestedSource, RagError> {
    let source_name = sanitize_source_name(&source.source_name)?;
    validate_supported_source_name(&source_name)?;

    let content = normalize_content(&source.content);
    if content.trim().is_empty() {
        return Err(RagError::EmptySource { source_name });
    }

    let size_bytes = content.as_bytes().len();
    if size_bytes > MAX_SOURCE_BYTES {
        return Err(RagError::SourceTooLarge {
            source_name,
            actual_bytes: size_bytes,
            max_bytes: MAX_SOURCE_BYTES,
        });
    }

    let sha256 = sha256_hex(content.as_bytes());
    let source_id = format!("asset_{}", &sha256[..16]);
    let asset_file_name = format!("{}-{}", &sha256[..16], source_name);
    let vault_relative_path = format!("assets/{asset_file_name}");
    fs::write(layout.assets_dir().join(&asset_file_name), &content)?;

    let chunks = chunk_source(&source_id, &source_name, &content);
    let chunk_count = chunks.len();
    let created_at_unix_ms = now_unix_ms();

    let transaction = connection.transaction()?;
    transaction.execute(
        "
        INSERT INTO source_assets (
            source_id, source_name, sha256, size_bytes, vault_relative_path, created_at_unix_ms
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(source_id) DO UPDATE SET
            source_name = excluded.source_name,
            size_bytes = excluded.size_bytes,
            vault_relative_path = excluded.vault_relative_path,
            created_at_unix_ms = excluded.created_at_unix_ms
        ",
        params![
            source_id,
            source_name,
            sha256,
            size_bytes as i64,
            vault_relative_path,
            created_at_unix_ms
        ],
    )?;
    transaction.execute("DELETE FROM source_chunks WHERE source_id = ?1", params![source_id])?;
    transaction.execute(
        "DELETE FROM source_chunks_fts WHERE source_id = ?1",
        params![source_id],
    )?;

    for chunk in &chunks {
        transaction.execute(
            "
            INSERT INTO source_chunks (
                chunk_id, source_id, source_name, chunk_index, start_line, end_line, text
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            params![
                chunk.chunk_id,
                chunk.source_id,
                chunk.source_name,
                chunk.chunk_index as i64,
                chunk.start_line as i64,
                chunk.end_line as i64,
                chunk.text,
            ],
        )?;
        transaction.execute(
            "
            INSERT INTO source_chunks_fts (chunk_id, source_id, source_name, text)
            VALUES (?1, ?2, ?3, ?4)
            ",
            params![chunk.chunk_id, chunk.source_id, chunk.source_name, chunk.text],
        )?;
    }

    transaction.commit()?;

    Ok(IngestedSource {
        source_id,
        source_name,
        sha256,
        size_bytes: size_bytes as u64,
        chunk_count,
        vault_relative_path,
    })
}

fn list_sources(connection: &Connection) -> Result<Vec<IngestedSource>, RagError> {
    let mut statement = connection.prepare(
        "
        SELECT
            a.source_id,
            a.source_name,
            a.sha256,
            a.size_bytes,
            a.vault_relative_path,
            COUNT(c.chunk_id) AS chunk_count
        FROM source_assets a
        LEFT JOIN source_chunks c ON c.source_id = a.source_id
        GROUP BY a.source_id
        ORDER BY a.created_at_unix_ms DESC, a.source_name ASC
        ",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(IngestedSource {
            source_id: row.get(0)?,
            source_name: row.get(1)?,
            sha256: row.get(2)?,
            size_bytes: row.get::<_, i64>(3)? as u64,
            vault_relative_path: row.get(4)?,
            chunk_count: row.get::<_, i64>(5)? as usize,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(RagError::from)
}

fn search_chunks(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<RetrievedChunk>, RagError> {
    let limit = limit.clamp(1, 24);
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return latest_chunks(connection, limit);
    }

    let mut statement = connection.prepare(
        "
        SELECT
            c.chunk_id,
            c.source_id,
            c.source_name,
            c.start_line,
            c.end_line,
            c.text,
            bm25(source_chunks_fts) AS score
        FROM source_chunks_fts
        JOIN source_chunks c ON c.chunk_id = source_chunks_fts.chunk_id
        WHERE source_chunks_fts MATCH ?1
        ORDER BY score ASC
        LIMIT ?2
        ",
    )?;
    let rows = statement.query_map(params![fts_query, limit as i64], row_to_retrieved_chunk)?;
    let chunks = rows.collect::<Result<Vec<_>, _>>()?;
    if chunks.is_empty() {
        latest_chunks(connection, limit)
    } else {
        Ok(chunks)
    }
}

fn latest_chunks(connection: &Connection, limit: usize) -> Result<Vec<RetrievedChunk>, RagError> {
    let mut statement = connection.prepare(
        "
        SELECT
            chunk_id, source_id, source_name, start_line, end_line, text, 0.0 AS score
        FROM source_chunks
        ORDER BY source_name ASC, chunk_index ASC
        LIMIT ?1
        ",
    )?;
    let rows = statement.query_map(params![limit as i64], row_to_retrieved_chunk)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(RagError::from)
}

fn row_to_retrieved_chunk(row: &rusqlite::Row<'_>) -> rusqlite::Result<RetrievedChunk> {
    Ok(RetrievedChunk {
        chunk_id: row.get(0)?,
        source_id: row.get(1)?,
        source_name: row.get(2)?,
        start_line: row.get::<_, i64>(3)? as u32,
        end_line: row.get::<_, i64>(4)? as u32,
        text: row.get(5)?,
        score: row.get(6)?,
    })
}

fn chunk_source(source_id: &str, source_name: &str, content: &str) -> Vec<SourceChunk> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut start_line = 1_u32;
    let mut last_line = 1_u32;

    for (index, line) in content.lines().enumerate() {
        let line_number = (index + 1) as u32;
        if current.is_empty() {
            start_line = line_number;
        }

        let trimmed = line.trim_end();
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(trimmed);
        last_line = line_number;

        let boundary = trimmed.is_empty() || trimmed.starts_with('#') || current.len() >= TARGET_CHUNK_CHARS;
        if current.len() >= MIN_CHUNK_CHARS && boundary {
            push_chunk(
                &mut chunks,
                source_id,
                source_name,
                start_line,
                last_line,
                &current,
            );
            current.clear();
        }

        if chunks.len() >= MAX_CHUNKS_PER_SOURCE {
            // Flush remaining accumulated content before breaking to prevent silent data loss
            if !current.trim().is_empty() {
                push_chunk(
                    &mut chunks,
                    source_id,
                    source_name,
                    start_line,
                    last_line,
                    &current,
                );
            }
            break;
        }
    }

    if !current.trim().is_empty() && chunks.len() < MAX_CHUNKS_PER_SOURCE {
        push_chunk(
            &mut chunks,
            source_id,
            source_name,
            start_line,
            last_line,
            &current,
        );
    }

    chunks
}

fn push_chunk(
    chunks: &mut Vec<SourceChunk>,
    source_id: &str,
    source_name: &str,
    start_line: u32,
    end_line: u32,
    text: &str,
) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }

    let chunk_index = chunks.len();
    chunks.push(SourceChunk {
        chunk_id: format!("{source_id}_chunk_{:04}", chunk_index + 1),
        source_id: source_id.to_string(),
        source_name: source_name.to_string(),
        chunk_index,
        start_line,
        end_line,
        text: text.to_string(),
    });
}

fn normalize_content(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n").trim().to_string()
}

fn sanitize_source_name(source_name: &str) -> Result<String, RagError> {
    let trimmed = source_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
    {
        return Err(RagError::InvalidSourceName(source_name.to_string()));
    }

    Ok(trimmed.to_string())
}

fn validate_supported_source_name(source_name: &str) -> Result<(), RagError> {
    let supported = source_name
        .rsplit_once('.')
        .map(|(_, extension)| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
        })
        .unwrap_or(false);

    if supported {
        Ok(())
    } else {
        Err(RagError::UnsupportedSourceType(source_name.to_string()))
    }
}

fn build_fts_query(query: &str) -> String {
    let mut terms = Vec::new();
    for term in query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 3)
        .take(8)
    {
        terms.push(format!("{}*", term.to_lowercase()));
    }

    terms.join(" OR ")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push_str(&format!("{byte:02x}"));
    }
    encoded
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn ingests_sources_and_analyzes_with_fts() {
        let root = test_vault_root("ingests_sources_and_analyzes_with_fts");
        let sources = vec![
            SourceUpload {
                source_name: "memory.md".to_string(),
                content: "# Memory\nRetrieval practice improves durable recall.\nSpacing helps long-term retention."
                    .to_string(),
            },
            SourceUpload {
                source_name: "systems.md".to_string(),
                content: "# Systems\nProcess scheduling chooses which task runs next.\nPreemption interrupts a running process."
                    .to_string(),
            },
        ];

        let ingested = ingest_markdown_sources(&root, &sources).expect("sources should ingest");
        assert_eq!(ingested.len(), 2);
        assert!(root.join("assets").exists());
        assert!(root.join(".app").join("index.sqlite").exists());

        let analysis =
            analyze_indexed_sources(&root, "retrieval recall").expect("analysis should work");
        assert_eq!(analysis.sources.len(), 2);
        assert!(!analysis.chunks.is_empty());
        assert_eq!(analysis.draft.source_name, "rag-analysis.md");
        assert!(analysis
            .draft
            .nodes
            .iter()
            .any(|node| node.source.starts_with("memory.md:")));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unsafe_source_path() {
        let root = test_vault_root("rejects_unsafe_source_path");
        let error = ingest_markdown_sources(
            &root,
            &[SourceUpload {
                source_name: "../notes.md".to_string(),
                content: "unsafe".to_string(),
            }],
        )
        .expect_err("unsafe source should fail");

        assert!(matches!(error, RagError::InvalidSourceName(_)));
        let _ = fs::remove_dir_all(root);
    }

    fn test_vault_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!(
            "learn-alone-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        root
    }
}
