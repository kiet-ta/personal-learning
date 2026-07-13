//! Project-owned Source Versions and typed Evidence Locators.
//!
//! Per `CONTEXT.md`:
//!
//! - A Source belongs to exactly one Project.
//! - Imports create managed snapshots; subsequent imports create
//!   immutable Source Versions.
//! - Evidence always references a specific Source Version so later
//!   imports cannot silently change citations.
//! - Evidence Locator is typed: line and character range for
//!   Markdown/text (this MVP scope; PDF and image are not yet wired).
//!
//! This module is intentionally small and explicit. The filesystem
//! Markdown vault stays canonical; SQLite stays a rebuildable index.

use std::error::Error;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::project_vault::{ProjectVault, ProjectVaultError};
use crate::vault::VaultLayout;

pub const SOURCE_VERSION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceVersion {
    pub schema_version: u32,
    pub project_id: String,
    pub source_id: String,
    pub version_id: String,
    pub source_name: String,
    pub sha256: String,
    pub modality: String,
    pub size_bytes: u64,
    pub created_at_unix_ms: i64,
    pub version_kind: SourceVersionKind,
    pub vault_relative_path: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceVersionKind {
    Initial,
    Updated,
}

impl SourceVersionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::Updated => "updated",
        }
    }
}

impl fmt::Display for SourceVersionKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLocator {
    pub schema_version: u32,
    pub source_version_id: String,
    pub source_id: String,
    pub start_line: u32,
    pub end_line: u32,
    pub start_offset: u32,
    pub end_offset: u32,
    pub excerpt: String,
}

#[derive(Debug)]
pub enum SourceVersionError {
    EmptyName,
    UnsupportedExtension(String),
    EmptyContent,
    OversizedContent { size: usize, max: usize },
    ProjectNotFound(String),
    Io(std::io::Error),
    ProjectVault(ProjectVaultError),
}

impl fmt::Display for SourceVersionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyName => write!(formatter, "Source name is empty."),
            Self::UnsupportedExtension(ext) => {
                write!(formatter, "Unsupported source extension: {ext}.")
            }
            Self::EmptyContent => write!(formatter, "Source content is empty."),
            Self::OversizedContent { size, max } => write!(
                formatter,
                "Source content is too large ({size} bytes; max {max})."
            ),
            Self::ProjectNotFound(project_id) => {
                write!(formatter, "Project not found: {project_id}.")
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::ProjectVault(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for SourceVersionError {}

impl From<std::io::Error> for SourceVersionError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<ProjectVaultError> for SourceVersionError {
    fn from(error: ProjectVaultError) -> Self {
        Self::ProjectVault(error)
    }
}

impl From<crate::node_persistence::NodePersistenceError> for SourceVersionError {
    fn from(error: crate::node_persistence::NodePersistenceError) -> Self {
        match error {
            crate::node_persistence::NodePersistenceError::Io(io) => Self::Io(io),
            other => Self::Io(std::io::Error::new(std::io::ErrorKind::Other, other.to_string())),
        }
    }
}

const MAX_BYTES: usize = 2 * 1024 * 1024;

fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn reject_source_name(name: &str) -> Result<&str, SourceVersionError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(SourceVersionError::EmptyName);
    }
    let lower = trimmed.to_ascii_lowercase();
    if !matches!(
        lower.rsplit('.').next(),
        Some("txt") | Some("md") | Some("markdown")
    ) {
        return Err(SourceVersionError::UnsupportedExtension(trimmed.to_string()));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains(':') {
        return Err(SourceVersionError::EmptyName);
    }
    Ok(trimmed)
}

fn compute_sha256(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    hex
}

fn safe_relative_path(source_id: &str, version_id: &str, source_name: &str) -> String {
    // Filename is `<source_id>-<version_id>-<safe-name>.md`.
    let safe_name = source_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    format!("{source_id}-{version_id}-{safe_name}")
}

pub struct SourceVersionRegistry {
    layout: VaultLayout,
}

impl SourceVersionRegistry {
    pub fn new(vault_root: impl AsRef<Path>) -> Self {
        Self {
            layout: VaultLayout::new(vault_root.as_ref()),
        }
    }

    /// List all Source Versions that belong to a given Project.
    pub fn list_for_project(
        &self,
        project_id: &str,
    ) -> Result<Vec<SourceVersion>, SourceVersionError> {
        let dir = self.project_sources_dir(project_id);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut versions = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }
            let raw = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            if let Some(parsed) = parse_source_version_file(&raw) {
                versions.push(parsed);
            }
        }
        versions.sort_by(|a, b| a.created_at_unix_ms.cmp(&b.created_at_unix_ms));
        Ok(versions)
    }

    /// Read a Source Version by its `version_id`, scoped to a Project.
    pub fn read(
        &self,
        project_id: &str,
        version_id: &str,
    ) -> Result<SourceVersion, SourceVersionError> {
        for v in self.list_for_project(project_id)? {
            if v.version_id == version_id {
                return Ok(v);
            }
        }
        Err(SourceVersionError::ProjectNotFound(format!(
            "source version {version_id} not found in project {project_id}"
        )))
    }

    /// Ingest a new Source Version under a Project.
    ///
    /// `source_id` may be empty to indicate a brand-new Source — the
    /// implementation will mint one. Subsequent ingests with the same
    /// `source_id` create `Updated` versions; the previous version
    /// remains on disk and continues to be cited by older Evidence.
    pub fn ingest(
        &self,
        project_id: &str,
        source_id: Option<&str>,
        source_name: &str,
        content: &str,
        now_unix_ms: i64,
    ) -> Result<SourceVersion, SourceVersionError> {
        let name = reject_source_name(source_name)?.to_string();
        let normalized = normalize_line_endings(content);
        if normalized.trim().is_empty() {
            return Err(SourceVersionError::EmptyContent);
        }
        if normalized.len() > MAX_BYTES {
            return Err(SourceVersionError::OversizedContent {
                size: normalized.len(),
                max: MAX_BYTES,
            });
        }
        let project_vault = ProjectVault::initialize(self.layout.root())?;
        let project_exists = project_vault
            .list_projects()?
            .iter()
            .any(|p| p.project_id == project_id);
        if !project_exists {
            return Err(SourceVersionError::ProjectNotFound(project_id.to_string()));
        }

        let resolved_source_id = source_id
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("src_{}", now_unix_ms));

        let previous = self.list_for_project(project_id)?;
        let version_kind = if previous
            .iter()
            .any(|v| v.source_id == resolved_source_id)
        {
            SourceVersionKind::Updated
        } else {
            SourceVersionKind::Initial
        };

        let version_id = format!(
            "v_{}_{}",
            now_unix_ms,
            previous
                .iter()
                .filter(|v| v.source_id == resolved_source_id)
                .count()
        );
        let sha = compute_sha256(&normalized);
        let size_bytes = normalized.as_bytes().len() as u64;

        let relative = format!(
            "projects/{project_id}/sources/{}.md",
            safe_relative_path(&resolved_source_id, &version_id, &name)
        );
        let project_sources_dir = self.project_sources_dir(project_id);
        fs::create_dir_all(&project_sources_dir)?;

        let frontmatter = format!(
            "---\nschema_version: {SOURCE_VERSION_SCHEMA_VERSION}\nproject_id: {project_id}\nsource_id: {resolved_source_id}\nversion_id: {version_id}\nsource_name: {name}\nsha256: {sha}\nmodality: text\nsize_bytes: {size_bytes}\ncreated_at_unix_ms: {now_unix_ms}\nversion_kind: {}\n---\n\n",
            version_kind.as_str()
        );

        let file_path = project_sources_dir.join(format!(
            "{}.md",
            safe_relative_path(&resolved_source_id, &version_id, &name)
        ));
        let full = format!("{frontmatter}{normalized}");
        crate::atomic_write::node_persistence_like_write(&file_path, full.as_bytes())?;

        Ok(SourceVersion {
            schema_version: SOURCE_VERSION_SCHEMA_VERSION,
            project_id: project_id.to_string(),
            source_id: resolved_source_id,
            version_id,
            source_name: name,
            sha256: sha,
            modality: "text".to_string(),
            size_bytes,
            created_at_unix_ms: now_unix_ms,
            version_kind,
            vault_relative_path: relative,
        })
    }

    fn project_sources_dir(&self, project_id: &str) -> PathBuf {
        self.layout
            .root()
            .join("projects")
            .join(project_id)
            .join("sources")
    }
}

fn parse_source_version_file(content: &str) -> Option<SourceVersion> {
    let mut schema_version = SOURCE_VERSION_SCHEMA_VERSION;
    let mut project_id = String::new();
    let mut source_id = String::new();
    let mut version_id = String::new();
    let mut source_name = String::new();
    let mut sha256 = String::new();
    let mut modality = "text".to_string();
    let mut size_bytes: u64 = 0;
    let mut created_at_unix_ms: i64 = 0;
    let mut version_kind = SourceVersionKind::Initial;

    let mut lines = content.lines();
    let first = lines.next()?;
    if first.trim() != "---" {
        return None;
    }
    for line in lines {
        let trimmed = line.trim_end();
        if trimmed == "---" {
            break;
        }
        let (key, value) = trimmed.split_once(':')?;
        let value = value.trim();
        match key.trim() {
            "schema_version" => schema_version = value.parse().ok()?,
            "project_id" => project_id = value.to_string(),
            "source_id" => source_id = value.to_string(),
            "version_id" => version_id = value.to_string(),
            "source_name" => source_name = value.to_string(),
            "sha256" => sha256 = value.to_string(),
            "modality" => modality = value.to_string(),
            "size_bytes" => size_bytes = value.parse().ok()?,
            "created_at_unix_ms" => created_at_unix_ms = value.parse().ok()?,
            "version_kind" => {
                version_kind = match value {
                    "initial" => SourceVersionKind::Initial,
                    "updated" => SourceVersionKind::Updated,
                    _ => return None,
                }
            }
            _ => continue,
        }
    }

    if project_id.is_empty() || version_id.is_empty() {
        return None;
    }

    let relative_path = format!("projects/{project_id}/sources/{source_id}-{version_id}-{source_name}");

    Some(SourceVersion {
        schema_version,
        project_id,
        source_id,
        version_id,
        source_name,
        sha256,
        modality,
        size_bytes,
        created_at_unix_ms,
        version_kind,
        vault_relative_path: relative_path,
    })
}

/// Build a typed Evidence Locator for a line range inside a Source
/// Version body.
pub fn build_evidence_locator(
    source_version: &SourceVersion,
    content: &str,
    start_line: u32,
    end_line: u32,
) -> EvidenceLocator {
    let mut current_line: u32 = 1;
    let mut start_offset: u32 = 0;
    let mut end_offset: u32 = 0;
    let mut in_range = false;
    for (offset, ch) in content.char_indices() {
        if current_line == start_line && !in_range {
            start_offset = offset as u32;
            in_range = true;
        }
        if current_line == end_line {
            end_offset = (offset + ch.len_utf8()) as u32;
            break;
        }
        if ch == '\n' {
            current_line = current_line.saturating_add(1);
        }
    }
    let start = (start_line as usize).saturating_sub(1).min(content.len());
    let end = (end_line as usize).min(content.lines().count().max(1));
    let excerpt = content
        .lines()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect::<Vec<_>>()
        .join("\n");

    EvidenceLocator {
        schema_version: SOURCE_VERSION_SCHEMA_VERSION,
        source_version_id: source_version.version_id.clone(),
        source_id: source_version.source_id.clone(),
        start_line,
        end_line,
        start_offset,
        end_offset,
        excerpt,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(vault_root: &Path) -> SourceVersionRegistry {
        SourceVersionRegistry::new(vault_root)
    }

    fn setup_project(vault_root: &Path) -> String {
        let vault = ProjectVault::initialize(vault_root).expect("initialize");
        let layout = VaultLayout::new(vault_root);
        layout.ensure_dirs().expect("ensure_dirs");
        let snapshot = vault
            .create_project("Slice 3 test project")
            .expect("create project");
        snapshot.project.project_id
    }

    #[test]
    fn ingest_initial_version_records_kind_initial() {
        let root = std::env::temp_dir().join(format!(
            "slice3-source-versions-initial-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup_project(&root);
        let registry = registry(&root);

        let version = registry
            .ingest(
                &project_id,
                None,
                "chapter-1.md",
                "First lines of chapter one.\nMore detail.\n",
                1_700_000_000_000,
            )
            .expect("ingest must succeed");

        assert_eq!(version.version_kind, SourceVersionKind::Initial);
        assert!(version.vault_relative_path.starts_with("projects/"));
        assert!(version.sha256.len() == 64);

        let list = registry.list_for_project(&project_id).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].version_id, version.version_id);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn second_ingest_with_same_source_id_creates_updated_version() {
        let root = std::env::temp_dir().join(format!(
            "slice3-source-versions-updated-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup_project(&root);
        let registry = registry(&root);

        let first = registry
            .ingest(
                &project_id,
                Some("src_reusable"),
                "chapter-2.md",
                "first content\n",
                1_700_000_000_000,
            )
            .expect("first ingest");
        assert_eq!(first.version_kind, SourceVersionKind::Initial);

        let second = registry
            .ingest(
                &project_id,
                Some("src_reusable"),
                "chapter-2.md",
                "updated content\n",
                1_700_000_001_000,
            )
            .expect("second ingest");
        assert_eq!(second.version_kind, SourceVersionKind::Updated);
        assert_ne!(first.version_id, second.version_id);

        let list = registry.list_for_project(&project_id).expect("list");
        assert_eq!(list.len(), 2, "older version must remain on disk");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unsafe_source_names_and_empty_content() {
        let root = std::env::temp_dir().join(format!(
            "slice3-source-versions-validation-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_id = setup_project(&root);
        let registry = registry(&root);

        assert!(matches!(
            registry.ingest(&project_id, None, "image.png", "x", 1),
            Err(SourceVersionError::UnsupportedExtension(_))
        ));
        assert!(matches!(
            registry.ingest(&project_id, None, "../escape.md", "x", 1),
            Err(SourceVersionError::EmptyName)
        ));
        assert!(matches!(
            registry.ingest(&project_id, None, "ok.md", "   \n", 1),
            Err(SourceVersionError::EmptyContent)
        ));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn evidence_locator_captures_line_range() {
        let source = SourceVersion {
            schema_version: SOURCE_VERSION_SCHEMA_VERSION,
            project_id: "p".into(),
            source_id: "s".into(),
            version_id: "v".into(),
            source_name: "doc.md".into(),
            sha256: "x".into(),
            modality: "text".into(),
            size_bytes: 0,
            created_at_unix_ms: 0,
            version_kind: SourceVersionKind::Initial,
            vault_relative_path: "x".into(),
        };
        let body = "line one\nline two\nline three\nline four\n";
        let locator = build_evidence_locator(&source, body, 2, 3);
        assert_eq!(locator.start_line, 2);
        assert_eq!(locator.end_line, 3);
        assert!(locator.excerpt.contains("line two"));
        assert!(locator.excerpt.contains("line three"));
        assert!(!locator.excerpt.contains("line one"));
    }
}