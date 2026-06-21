use std::error::Error;
use std::fmt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::VaultLayout;

#[derive(Debug)]
pub enum WorkspaceError {
    EmptyTitle,
    EmptyBody,
    InvalidSuggestionStatus(String),
    SuggestionNotFound(String),
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => write!(formatter, "Note title is empty."),
            Self::EmptyBody => write!(formatter, "Note body is empty."),
            Self::InvalidSuggestionStatus(status) => {
                write!(formatter, "Invalid suggestion status: {status}.")
            }
            Self::SuggestionNotFound(suggestion_id) => {
                write!(formatter, "Suggestion was not found: {suggestion_id}.")
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Sqlite(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for WorkspaceError {}

impl From<std::io::Error> for WorkspaceError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for WorkspaceError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LearningNote {
    pub note_id: String,
    pub title: String,
    pub body_markdown: String,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAiSuggestion {
    pub suggestion_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub relation_kind: String,
    pub rationale: String,
    pub confidence: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiSuggestion {
    pub suggestion_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub relation_kind: String,
    pub rationale: String,
    pub confidence: u8,
    pub status: SuggestionStatus,
    pub created_at_unix_ms: i64,
    pub decided_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionStatus {
    Pending,
    Approved,
    Rejected,
}

impl SuggestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }

    pub fn parse(value: &str) -> Result<Self, WorkspaceError> {
        match value {
            "pending" => Ok(Self::Pending),
            "approved" => Ok(Self::Approved),
            "rejected" => Ok(Self::Rejected),
            other => Err(WorkspaceError::InvalidSuggestionStatus(other.to_string())),
        }
    }
}

pub fn save_learning_note(
    vault_root: impl AsRef<Path>,
    title: &str,
    body_markdown: &str,
) -> Result<LearningNote, WorkspaceError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(WorkspaceError::EmptyTitle);
    }
    let body_markdown = body_markdown.trim();
    if body_markdown.is_empty() {
        return Err(WorkspaceError::EmptyBody);
    }

    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_workspace_index(&layout)?;
    ensure_workspace_schema(&connection)?;

    let updated_at_unix_ms = now_unix_ms();
    let note_id = stable_id("note", &[title, body_markdown]);
    connection.execute(
        "
        INSERT INTO learning_notes (note_id, title, body_markdown, updated_at_unix_ms)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(note_id) DO UPDATE SET
            title = excluded.title,
            body_markdown = excluded.body_markdown,
            updated_at_unix_ms = excluded.updated_at_unix_ms
        ",
        params![note_id, title, body_markdown, updated_at_unix_ms],
    )?;

    Ok(LearningNote {
        note_id,
        title: title.to_string(),
        body_markdown: body_markdown.to_string(),
        updated_at_unix_ms,
    })
}

pub fn list_learning_notes(
    vault_root: impl AsRef<Path>,
) -> Result<Vec<LearningNote>, WorkspaceError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_workspace_index(&layout)?;
    ensure_workspace_schema(&connection)?;

    let mut statement = connection.prepare(
        "
        SELECT note_id, title, body_markdown, updated_at_unix_ms
        FROM learning_notes
        ORDER BY updated_at_unix_ms DESC, title ASC
        ",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(LearningNote {
            note_id: row.get(0)?,
            title: row.get(1)?,
            body_markdown: row.get(2)?,
            updated_at_unix_ms: row.get(3)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(WorkspaceError::from)
}

pub fn save_ai_suggestions(
    vault_root: impl AsRef<Path>,
    suggestions: &[NewAiSuggestion],
) -> Result<Vec<AiSuggestion>, WorkspaceError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let mut connection = open_workspace_index(&layout)?;
    ensure_workspace_schema(&connection)?;

    let created_at_unix_ms = now_unix_ms();
    let transaction = connection.transaction()?;
    for suggestion in suggestions {
        transaction.execute(
            "
            INSERT INTO ai_suggestions (
                suggestion_id, from_node_id, to_node_id, relation_kind, rationale,
                confidence, status, created_at_unix_ms, decided_at_unix_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL)
            ON CONFLICT(suggestion_id) DO UPDATE SET
                from_node_id = excluded.from_node_id,
                to_node_id = excluded.to_node_id,
                relation_kind = excluded.relation_kind,
                rationale = excluded.rationale,
                confidence = excluded.confidence,
                status = 'pending',
                decided_at_unix_ms = NULL
            ",
            params![
                suggestion.suggestion_id,
                suggestion.from_node_id,
                suggestion.to_node_id,
                suggestion.relation_kind,
                suggestion.rationale,
                suggestion.confidence as i64,
                created_at_unix_ms,
            ],
        )?;
    }
    transaction.commit()?;

    list_ai_suggestions(layout.root())
}

pub fn list_ai_suggestions(
    vault_root: impl AsRef<Path>,
) -> Result<Vec<AiSuggestion>, WorkspaceError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_workspace_index(&layout)?;
    ensure_workspace_schema(&connection)?;

    let mut statement = connection.prepare(
        "
        SELECT
            suggestion_id,
            from_node_id,
            to_node_id,
            relation_kind,
            rationale,
            confidence,
            status,
            created_at_unix_ms,
            decided_at_unix_ms
        FROM ai_suggestions
        ORDER BY
            CASE status
                WHEN 'pending' THEN 0
                WHEN 'approved' THEN 1
                ELSE 2
            END,
            created_at_unix_ms DESC
        ",
    )?;
    let rows = statement.query_map([], row_to_suggestion)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(WorkspaceError::from)
}

pub fn record_suggestion_decision(
    vault_root: impl AsRef<Path>,
    suggestion_id: &str,
    status: SuggestionStatus,
) -> Result<AiSuggestion, WorkspaceError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;
    let connection = open_workspace_index(&layout)?;
    ensure_workspace_schema(&connection)?;

    let decided_at_unix_ms = match status {
        SuggestionStatus::Pending => None,
        SuggestionStatus::Approved | SuggestionStatus::Rejected => Some(now_unix_ms()),
    };
    connection.execute(
        "
        UPDATE ai_suggestions
        SET status = ?1, decided_at_unix_ms = ?2
        WHERE suggestion_id = ?3
        ",
        params![status.as_str(), decided_at_unix_ms, suggestion_id],
    )?;

    find_ai_suggestion(&connection, suggestion_id)?
        .ok_or_else(|| WorkspaceError::SuggestionNotFound(suggestion_id.to_string()))
}

fn open_workspace_index(layout: &VaultLayout) -> Result<Connection, WorkspaceError> {
    Ok(Connection::open(layout.index_path())?)
}

fn ensure_workspace_schema(connection: &Connection) -> Result<(), WorkspaceError> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS learning_notes (
            note_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body_markdown TEXT NOT NULL,
            updated_at_unix_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_nodes (
            node_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            body_markdown TEXT NOT NULL,
            source_anchor TEXT NOT NULL,
            created_at_unix_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_edges (
            edge_id TEXT PRIMARY KEY,
            from_node_id TEXT NOT NULL,
            to_node_id TEXT NOT NULL,
            relation_kind TEXT NOT NULL,
            created_at_unix_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_suggestions (
            suggestion_id TEXT PRIMARY KEY,
            from_node_id TEXT NOT NULL,
            to_node_id TEXT NOT NULL,
            relation_kind TEXT NOT NULL,
            rationale TEXT NOT NULL,
            confidence INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
            created_at_unix_ms INTEGER NOT NULL,
            decided_at_unix_ms INTEGER
        );
        ",
    )?;
    Ok(())
}

fn find_ai_suggestion(
    connection: &Connection,
    suggestion_id: &str,
) -> Result<Option<AiSuggestion>, WorkspaceError> {
    connection
        .query_row(
            "
            SELECT
                suggestion_id,
                from_node_id,
                to_node_id,
                relation_kind,
                rationale,
                confidence,
                status,
                created_at_unix_ms,
                decided_at_unix_ms
            FROM ai_suggestions
            WHERE suggestion_id = ?1
            ",
            params![suggestion_id],
            row_to_suggestion,
        )
        .optional()
        .map_err(WorkspaceError::from)
}

fn row_to_suggestion(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiSuggestion> {
    let status: String = row.get(6)?;
    Ok(AiSuggestion {
        suggestion_id: row.get(0)?,
        from_node_id: row.get(1)?,
        to_node_id: row.get(2)?,
        relation_kind: row.get(3)?,
        rationale: row.get(4)?,
        confidence: row.get::<_, i64>(5)? as u8,
        status: SuggestionStatus::parse(&status).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        created_at_unix_ms: row.get(7)?,
        decided_at_unix_ms: row.get(8)?,
    })
}

fn stable_id(prefix: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"\0");
    }
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(20);
    for byte in digest.iter().take(10) {
        encoded.push_str(&format!("{byte:02x}"));
    }
    format!("{prefix}_{encoded}")
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn saves_and_lists_learning_notes() {
        let root = test_vault_root("saves_and_lists_learning_notes");
        let note = save_learning_note(
            &root,
            "Graph search",
            "Graph search should keep source anchors visible.",
        )
        .expect("note should save");

        let notes = list_learning_notes(&root).expect("notes should list");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].note_id, note.note_id);
        assert_eq!(notes[0].title, "Graph search");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn records_suggestion_decisions_without_auto_commit() {
        let root = test_vault_root("records_suggestion_decisions_without_auto_commit");
        let saved = save_ai_suggestions(
            &root,
            &[NewAiSuggestion {
                suggestion_id: "suggestion_001".to_string(),
                from_node_id: "draft_a".to_string(),
                to_node_id: "node_b".to_string(),
                relation_kind: "supports".to_string(),
                rationale: "Both nodes explain retrieval practice.".to_string(),
                confidence: 84,
            }],
        )
        .expect("suggestion should save");
        assert_eq!(saved[0].status, SuggestionStatus::Pending);

        let decided =
            record_suggestion_decision(&root, "suggestion_001", SuggestionStatus::Approved)
                .expect("suggestion should be approved");
        assert_eq!(decided.status, SuggestionStatus::Approved);
        assert!(decided.decided_at_unix_ms.is_some());

        let _ = fs::remove_dir_all(root);
    }

    fn test_vault_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!(
            "learn-alone-workspace-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        root
    }
}
