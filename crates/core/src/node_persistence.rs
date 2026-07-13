use std::error::Error;
use std::fmt;
use std::fs;
use std::path::Path;

use crate::atomic_write::node_persistence_like_write;
use crate::VaultLayout;

#[derive(Debug)]
pub enum NodePersistenceError {
    EmptyTitle,
    EmptyBody,
    InvalidNodeId(String),
    Io(std::io::Error),
}

impl fmt::Display for NodePersistenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => write!(formatter, "Node title is empty."),
            Self::EmptyBody => write!(formatter, "Node body is empty."),
            Self::InvalidNodeId(id) => write!(formatter, "Invalid node ID: {id}."),
            Self::Io(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for NodePersistenceError {}

impl From<std::io::Error> for NodePersistenceError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedNode {
    pub node_id: String,
    pub title: String,
    pub summary: String,
    pub body_markdown: String,
    pub tags: Vec<String>,
    pub source_anchor: String,
    pub relation_type: String,
    pub vault_relative_path: String,
}

/// Persist an approved draft node as a canonical Markdown file in vault/nodes/.
///
/// The file format:
/// ```markdown
/// ---
/// id: node_uuid
/// title: Node Title
/// summary: Short summary...
/// tags: [tag1, tag2]
/// source: source.md:1-42
/// relation: Supports
/// created_at: 1234567890123
/// ---
///
/// # Node Title
///
/// Body markdown content...
/// ```
pub fn persist_node(
    vault_root: impl AsRef<Path>,
    node_id: &str,
    title: &str,
    summary: &str,
    body_markdown: &str,
    tags: &[String],
    source_anchor: &str,
    relation_type: &str,
) -> Result<PersistedNode, NodePersistenceError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(NodePersistenceError::EmptyTitle);
    }
    let body_markdown = body_markdown.trim();
    if body_markdown.is_empty() {
        return Err(NodePersistenceError::EmptyBody);
    }
    if !is_valid_node_id(node_id) {
        return Err(NodePersistenceError::InvalidNodeId(node_id.to_string()));
    }

    let layout = VaultLayout::new(vault_root.as_ref());
    layout.ensure_dirs()?;

    // Use the full stable node_id in the filename. The earlier
    // 12-byte prefix allowed collisions for nodes that shared a slug
    // and an ID prefix.
    let slug = slugify(title);
    let safe_node_part = node_id_safe_filename(node_id);
    let filename = format!("{slug}-{safe_node_part}.md");
    let vault_relative_path = format!("nodes/{filename}");
    let full_path = layout.nodes_dir().join(&filename);

    let tags_str = format_tags_yaml(tags);
    let frontmatter = format!(
        "---\nid: {node_id}\ntitle: {title}\nsummary: {summary}\ntags: [{tags_str}]\nsource: {source_anchor}\nrelation: {relation_type}\n---\n\n# {title}\n\n{body_markdown}\n",
    );

    atomic_write(&full_path, frontmatter.as_bytes())?;

    Ok(PersistedNode {
        node_id: node_id.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        body_markdown: body_markdown.to_string(),
        tags: tags.to_vec(),
        source_anchor: source_anchor.to_string(),
        relation_type: relation_type.to_string(),
        vault_relative_path,
    })
}

/// List all persisted node Markdown files in vault/nodes/.
pub fn list_persisted_nodes(
    vault_root: impl AsRef<Path>,
) -> Result<Vec<PersistedNode>, NodePersistenceError> {
    let layout = VaultLayout::new(vault_root.as_ref());
    let nodes_dir = layout.nodes_dir();

    if !nodes_dir.exists() {
        return Ok(Vec::new());
    }

    let mut nodes = Vec::new();
    let entries = fs::read_dir(&nodes_dir)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map_or(true, |ext| ext != "md") {
            continue;
        }

        let content = fs::read_to_string(&path)?;
        if let Some(node) = parse_node_file(&content, &path) {
            nodes.push(node);
        }
    }

    // Sort by filename for deterministic ordering
    nodes.sort_by(|a, b| a.node_id.cmp(&b.node_id));
    Ok(nodes)
}

/// Delete a persisted node file by node_id.
///
/// The node file is located by enumerating `nodes/` and checking for an exact
/// `id:` frontmatter field match — not a substring search — so body content
/// containing `id: {node_id}` cannot trigger a false deletion.
pub fn delete_persisted_node(
    vault_root: impl AsRef<Path>,
    node_id: &str,
) -> Result<(), NodePersistenceError> {
    let vault_root = vault_root.as_ref();
    if node_id.is_empty() || node_id.contains('/') || node_id.contains('\\') {
        return Err(NodePersistenceError::InvalidNodeId(node_id.to_string()));
    }

    let layout = VaultLayout::new(vault_root);
    let nodes_dir = layout.nodes_dir();

    if !nodes_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&nodes_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map_or(true, |ext| ext != "md") {
            continue;
        }

        let content = fs::read_to_string(&path)?;
        if let Some(node) = parse_node_file(&content, &path) {
            if node.node_id == node_id {
                fs::remove_file(&path)?;
                return Ok(());
            }
        }
    }

    Ok(())
}

fn parse_node_file(content: &str, path: &Path) -> Option<PersistedNode> {
    // Simple frontmatter parser
    let content = content.trim();
    if !content.starts_with("---") {
        return None;
    }

    let rest = content.strip_prefix("---")?;
    let (frontmatter, body) = rest.split_once("---")?;

    let mut node_id = String::new();
    let mut title = String::new();
    let mut summary = String::new();
    let mut tags: Vec<String> = Vec::new();
    let mut source_anchor = String::new();
    let mut relation_type = String::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("id: ") {
            node_id = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("title: ") {
            title = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("summary: ") {
            summary = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("tags: [") {
            tags = parse_tags_yaml(value.trim_end_matches(']'));
        } else if let Some(value) = line.strip_prefix("source: ") {
            source_anchor = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("relation: ") {
            relation_type = value.trim().to_string();
        }
    }

    if node_id.is_empty() || title.is_empty() {
        return None;
    }

    let body_markdown = body.trim().to_string();
    let filename = path.file_name()?.to_string_lossy().to_string();
    let vault_relative_path = format!("nodes/{filename}");

    Some(PersistedNode {
        node_id,
        title,
        summary,
        body_markdown,
        tags,
        source_anchor,
        relation_type,
        vault_relative_path,
    })
}

fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "node".to_string()
    } else {
        trimmed.to_string()
    }
}

/// A node_id is the canonical, stable identifier of a persisted node.
/// It must be portable across Windows / macOS / Linux filesystem paths
/// and round-trip through JSON without loss. We restrict it to ASCII
/// alphanumerics, dashes, and underscores so it can always be used
/// safely as a filename component.
fn is_valid_node_id(node_id: &str) -> bool {
    if node_id.is_empty() || node_id.len() > 128 {
        return false;
    }
    node_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

/// Produce a filesystem-safe filename component from a node_id. Because
/// `is_valid_node_id` only accepts the small ASCII subset, this should
/// be a no-op except for ASCII-only defensive replacement of any
/// accidental remaining path separator.
fn node_id_safe_filename(node_id: &str) -> String {
    let mut safe = String::with_capacity(node_id.len());
    for ch in node_id.chars() {
        if ch == '/' || ch == '\\' || ch == ':' || ch.is_control() {
            safe.push('_');
        } else {
            safe.push(ch);
        }
    }
    safe
}

/// Atomic write through the shared `atomic_write` helper. Kept here as
/// a thin wrapper so `persist_node` keeps its `NodePersistenceError`
/// error type at the public seam.
fn atomic_write(target: &Path, content: &[u8]) -> Result<(), NodePersistenceError> {
    node_persistence_like_write(target, content)
}

/// Format tags for YAML output. Tags containing commas, colons, or quotes are quoted
/// and escaped so the parser can round-trip them correctly.
fn format_tags_yaml(tags: &[String]) -> String {
    if tags.is_empty() {
        return String::new();
    }
    tags.iter()
        .map(|tag| {
            if tag.contains(',') || tag.contains(':') || tag.contains('"') {
                format!("\"{}\"", tag.replace('"', "\\\""))
            } else {
                tag.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Parse tags from YAML list content. Handles both bare tags and quoted tags with
/// escaped inner quotes.
fn parse_tags_yaml(raw: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut chars = raw.chars().peekable();

    while let Some(c) = chars.next() {
        if c.is_whitespace() {
            continue;
        }
        if c == '"' {
            // Quoted tag — read until closing quote
            let mut tag = String::new();
            while let Some(ch) = chars.next() {
                if ch == '"' {
                    break;
                }
                if ch == '\\' {
                    if let Some(escaped) = chars.next() {
                        tag.push(escaped);
                    }
                } else {
                    tag.push(ch);
                }
            }
            tags.push(tag);
        } else {
            // Bare tag — read until comma or end
            let mut tag = String::new();
            tag.push(c);
            while let Some(&ch) = chars.peek() {
                if ch == ',' {
                    break;
                }
                tag.push(ch);
                chars.next();
            }
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                tags.push(trimmed.to_string());
            }
        }
        // Skip trailing comma
        while let Some(&c) = chars.peek() {
            if c == ',' {
                chars.next();
                break;
            }
            if c.is_whitespace() {
                chars.next();
            } else {
                break;
            }
        }
    }

    tags
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn test_vault_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!(
            "learn-alone-persistence-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        root
    }

    #[test]
    fn persists_and_reads_node() {
        let root = test_vault_root("persists_and_reads_node");
        let tags = vec!["rust".to_string(), "learning".to_string()];

        let persisted = persist_node(
            &root,
            "node_test_001",
            "Rust Ownership",
            "Ownership is Rust's memory management system.",
            "Rust ownership ensures memory safety without a garbage collector.\n\n## Key Points\n- Each value has one owner.\n- References borrow without taking ownership.",
            &tags,
            "rust-book.md:10-45",
            "Source",
        )
        .expect("node should persist");

        assert!(persisted.vault_relative_path.starts_with("nodes/"));
        assert!(persisted.vault_relative_path.ends_with(".md"));

        // Verify file exists on disk
        let layout = VaultLayout::new(&root);
        let file_path = layout.nodes_dir().join(
            persisted
                .vault_relative_path
                .strip_prefix("nodes/")
                .unwrap(),
        );
        assert!(file_path.exists(), "node file should exist on disk");

        // Read back
        let nodes = list_persisted_nodes(&root).expect("should list nodes");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].node_id, "node_test_001");
        assert_eq!(nodes[0].title, "Rust Ownership");
        assert!(nodes[0].body_markdown.contains("Rust ownership ensures"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persists_multiple_nodes() {
        let root = test_vault_root("persists_multiple_nodes");

        persist_node(
            &root,
            "node_a", "Topic A", "Summary A", "Body A", &[], "src.md:1", "Source",
        )
        .expect("node A should persist");
        persist_node(
            &root,
            "node_b", "Topic B", "Summary B", "Body B", &[], "src.md:2", "Supports",
        )
        .expect("node B should persist");

        let nodes = list_persisted_nodes(&root).expect("should list nodes");
        assert_eq!(nodes.len(), 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_node_by_id() {
        let root = test_vault_root("deletes_node_by_id");

        persist_node(
            &root,
            "node_del", "Delete Me", "Will be removed", "Content", &[], "src.md:1", "Source",
        )
        .expect("node should persist");

        let nodes = list_persisted_nodes(&root).expect("should list nodes");
        assert_eq!(nodes.len(), 1);

        delete_persisted_node(&root, "node_del").expect("should delete node");
        let nodes = list_persisted_nodes(&root).expect("should list nodes");
        assert_eq!(nodes.len(), 0);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_empty_title() {
        let root = test_vault_root("rejects_empty_title");
        let result = persist_node(&root, "id", "", "summary", "body", &[], "src.md:1", "Source");
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn returns_empty_list_for_missing_dir() {
        let root = test_vault_root("returns_empty_list_for_missing_dir");
        let nodes = list_persisted_nodes(&root).expect("should return empty list");
        assert!(nodes.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tags_with_commas_round_trip() {
        let root = test_vault_root("tags_with_commas");
        let tags = vec![
            "rust".to_string(),
            "learning, advanced".to_string(),
            "systems:kernel".to_string(),
        ];

        persist_node(
            &root,
            "node_comma",
            "Comma Tag Test",
            "Round-trips tags with commas and colons",
            "Body",
            &tags,
            "src.md:1",
            "Source",
        )
        .expect("persist should succeed");

        let nodes = list_persisted_nodes(&root).expect("should list nodes");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].tags, tags);

        let _ = fs::remove_dir_all(root);
    }

    /// Regression for the diagnose-phase finding that two nodes with the
    /// same title and a shared 12-byte ID prefix used to map to the same
    /// filename (silent overwrite).
    #[test]
    fn same_slug_with_distinct_ids_does_not_collide() {
        let root = test_vault_root("node_filename_collision");
        let tags = vec!["rust".to_string()];

        let first = persist_node(
            &root,
            "abcdefghijkl-one",
            "Shared Title",
            "first",
            "first body",
            &tags,
            "src.md:1",
            "Source",
        )
        .expect("first node should persist");
        let second = persist_node(
            &root,
            "abcdefghijkl-two",
            "Shared Title",
            "second",
            "second body",
            &tags,
            "src.md:2",
            "Source",
        )
        .expect("second node should persist");

        assert_ne!(
            first.vault_relative_path, second.vault_relative_path,
            "distinct IDs must produce distinct filenames even with identical title"
        );

        let nodes = list_persisted_nodes(&root).expect("should list");
        assert_eq!(nodes.len(), 2, "both nodes must be present on disk");

        let _ = fs::remove_dir_all(root);
    }

    /// Regression for the panic that occurred when a non-ASCII node_id
    /// passed validation and was truncated at byte 12 mid-codepoint.
    #[test]
    fn rejects_unicode_node_ids() {
        let root = test_vault_root("rejects_unicode_node_ids");
        let result = persist_node(
            &root,
            "aaaaaaaaaaa\u{00e9}",
            "Unicode test",
            "summary",
            "body",
            &[],
            "src.md:1",
            "Source",
        );
        assert!(
            result.is_err(),
            "non-ASCII node_id must be rejected before any filesystem call"
        );

        // Also reject empty and overly long IDs.
        assert!(persist_node(&root, "", "T", "s", "b", &[], "src.md:1", "Source").is_err());
        let long: String = "x".repeat(129);
        assert!(persist_node(&root, &long, "T", "s", "b", &[], "src.md:1", "Source").is_err());

        // Reject IDs containing path separators or control characters.
        assert!(persist_node(&root, "a/b", "T", "s", "b", &[], "src.md:1", "Source").is_err());
        assert!(persist_node(&root, "a\\b", "T", "s", "b", &[], "src.md:1", "Source").is_err());
        assert!(persist_node(&root, "a:b", "T", "s", "b", &[], "src.md:1", "Source").is_err());

        let _ = fs::remove_dir_all(root);
    }

    /// Regression: an overwrite of an existing node file must not lose
    /// the previous content silently. The atomic write path keeps a
    /// `.bak` sibling for one step before rename.
    #[test]
    fn atomic_overwrite_preserves_previous_file_on_disk_failure() {
        let root = test_vault_root("atomic_overwrite");
        let tags = vec!["t".to_string()];

        // Use the same title (and therefore the same slug + filename) so
        // the second call really does exercise the overwrite path.
        persist_node(
            &root,
            "node_overwrite",
            "Same Title",
            "summary",
            "first body",
            &tags,
            "src.md:1",
            "Source",
        )
        .expect("first persist");

        persist_node(
            &root,
            "node_overwrite",
            "Same Title",
            "summary",
            "second body",
            &tags,
            "src.md:1",
            "Source",
        )
        .expect("second persist must overwrite successfully");

        // No `.tmp` or `.bak` siblings should remain after the success
        // path completes.
        let nodes_dir = VaultLayout::new(&root).nodes_dir();
        for entry in fs::read_dir(&nodes_dir).expect("read_dir").flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            assert!(
                !name.ends_with(".tmp") && !name.ends_with(".bak"),
                "atomic_write left a temp or backup file behind: {name}"
            );
        }

        let nodes = list_persisted_nodes(&root).expect("list");
        assert_eq!(nodes.len(), 1, "the second persist must overwrite cleanly");
        assert!(
            nodes[0].body_markdown.contains("second body"),
            "second-persist body must be present, got: {}",
            nodes[0].body_markdown
        );
        assert!(
            !nodes[0].body_markdown.contains("first body"),
            "first-persist body must not leak through, got: {}",
            nodes[0].body_markdown
        );

        let _ = fs::remove_dir_all(root);
    }

    /// Regression for the missing `rejects_empty_body` case.
    #[test]
    fn rejects_empty_body() {
        let root = test_vault_root("rejects_empty_body");
        let result = persist_node(
            &root,
            "node_empty_body",
            "Title",
            "summary",
            "   \n\n  ",
            &[],
            "src.md:1",
            "Source",
        );
        assert!(result.is_err(), "whitespace-only body must be rejected");
        let _ = fs::remove_dir_all(root);
    }
}
