use std::collections::HashSet;
use std::error::Error;
use std::fmt;
#[cfg(not(target_os = "windows"))]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{LearningNote, VaultLayout};

pub const PROJECT_SCHEMA_VERSION: u32 = 1;
pub const IMPORTED_PROJECT_ID: &str = "project_imported_legacy";
const PROJECT_MANIFEST_FILE: &str = "project.json";
const LEGACY_MIGRATION_FILE: &str = "project-v1.json";
const LEGACY_BACKUP_FILE: &str = "index-before-project-v1.sqlite";
const DEFAULT_NOTE_TITLE: &str = "Untitled note";
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum ProjectVaultError {
    EmptyTitle,
    InvalidEntityId { kind: &'static str, value: String },
    ProjectNotFound(String),
    NoteNotFound(String),
    UnsupportedSchemaVersion { actual: u32, expected: u32 },
    ManifestMismatch(String),
    SymlinkNotAllowed(PathBuf),
    InvalidFrontmatter(String),
    MigrationVerification(String),
    Io(std::io::Error),
    Json(serde_json::Error),
    Yaml(serde_yaml::Error),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for ProjectVaultError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => write!(formatter, "Title is empty."),
            Self::InvalidEntityId { kind, value } => {
                write!(formatter, "Invalid {kind} identifier: {value}.")
            }
            Self::ProjectNotFound(project_id) => {
                write!(formatter, "Project not found: {project_id}.")
            }
            Self::NoteNotFound(note_id) => write!(formatter, "Note not found: {note_id}."),
            Self::UnsupportedSchemaVersion { actual, expected } => write!(
                formatter,
                "Unsupported schema version {actual}; expected {expected}."
            ),
            Self::ManifestMismatch(message) => write!(formatter, "Manifest mismatch: {message}."),
            Self::SymlinkNotAllowed(path) => {
                write!(
                    formatter,
                    "Symlinks are not allowed inside managed project paths: {}.",
                    path.display()
                )
            }
            Self::InvalidFrontmatter(message) => {
                write!(formatter, "Invalid note frontmatter: {message}.")
            }
            Self::MigrationVerification(message) => {
                write!(
                    formatter,
                    "Legacy migration verification failed: {message}."
                )
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Json(error) => write!(formatter, "{error}"),
            Self::Yaml(error) => write!(formatter, "{error}"),
            Self::Sqlite(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for ProjectVaultError {}

impl From<std::io::Error> for ProjectVaultError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ProjectVaultError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<serde_yaml::Error> for ProjectVaultError {
    fn from(error: serde_yaml::Error) -> Self {
        Self::Yaml(error)
    }
}

impl From<rusqlite::Error> for ProjectVaultError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub project_id: String,
    pub title: String,
    pub slug: String,
    pub default_note_id: String,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectNote {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectSnapshot {
    pub project: ProjectManifest,
    pub default_note: ProjectNote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyMigrationStatus {
    Migrated,
    AlreadyCompleted,
    NoLegacyNotes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyMigrationReport {
    pub status: LegacyMigrationStatus,
    pub migrated_note_count: usize,
    pub imported_project_id: Option<String>,
    pub backup_vault_relative_path: Option<String>,
    pub content_sha256: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProjectVault {
    layout: VaultLayout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectNoteFrontmatter {
    schema_version: u32,
    project_id: String,
    note_id: String,
    title: String,
    slug: String,
    tags: Vec<String>,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    legacy_note_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMigrationMarker {
    schema_version: u32,
    migration_id: String,
    imported_project_id: String,
    migrated_note_count: usize,
    content_sha256: String,
    completed_at_unix_ms: i64,
    backup_vault_relative_path: String,
}

impl ProjectVault {
    pub fn initialize(vault_root: impl Into<PathBuf>) -> Result<Self, ProjectVaultError> {
        let layout = VaultLayout::new(vault_root);
        layout.ensure_dirs()?;
        reject_symlink(&layout.projects_dir())?;
        reject_symlink(&layout.migrations_dir())?;
        reject_symlink(&layout.backups_dir())?;
        Ok(Self { layout })
    }

    pub fn root(&self) -> &Path {
        self.layout.root()
    }

    pub fn create_project(&self, title: &str) -> Result<ProjectSnapshot, ProjectVaultError> {
        let title = normalized_title(title)?;
        let now = now_unix_ms();
        let project_id = new_entity_id("project", title);
        let default_note_id = new_entity_id("note", &project_id);
        let project_dir = self.project_dir(&project_id)?;

        if project_dir.exists() {
            return Err(ProjectVaultError::ManifestMismatch(format!(
                "generated project path already exists for {project_id}"
            )));
        }

        self.ensure_project_dirs(&project_id)?;
        let result = (|| {
            let default_note = self.write_note(
                &project_id,
                &default_note_id,
                DEFAULT_NOTE_TITLE,
                "",
                &[],
                now,
                now,
                None,
            )?;
            let project = ProjectManifest {
                schema_version: PROJECT_SCHEMA_VERSION,
                project_id: project_id.clone(),
                title: title.to_string(),
                slug: slugify(title),
                default_note_id,
                created_at_unix_ms: now,
                updated_at_unix_ms: now,
            };
            self.write_manifest(&project)?;
            Ok(ProjectSnapshot {
                project,
                default_note,
            })
        })();

        if result.is_err() {
            let _ = fs::remove_dir_all(&project_dir);
        }
        result
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectManifest>, ProjectVaultError> {
        let mut projects = Vec::new();
        for entry in fs::read_dir(self.layout.projects_dir())? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(ProjectVaultError::SymlinkNotAllowed(entry.path()));
            }
            if !file_type.is_dir() {
                continue;
            }
            let project_id = entry.file_name().to_string_lossy().to_string();
            validate_entity_id("project", &project_id)?;
            projects.push(self.load_project(&project_id)?);
        }
        projects.sort_by(|left, right| {
            right
                .updated_at_unix_ms
                .cmp(&left.updated_at_unix_ms)
                .then_with(|| left.title.cmp(&right.title))
        });
        Ok(projects)
    }

    pub fn load_project(&self, project_id: &str) -> Result<ProjectManifest, ProjectVaultError> {
        let manifest_path = self.project_manifest_path(project_id)?;
        if !manifest_path.exists() {
            return Err(ProjectVaultError::ProjectNotFound(project_id.to_string()));
        }
        reject_symlink(&manifest_path)?;
        let manifest: ProjectManifest = serde_json::from_slice(&fs::read(&manifest_path)?)?;
        validate_schema_version(manifest.schema_version)?;
        if manifest.project_id != project_id {
            return Err(ProjectVaultError::ManifestMismatch(format!(
                "folder id {project_id} does not match manifest id {}",
                manifest.project_id
            )));
        }
        validate_entity_id("note", &manifest.default_note_id)?;
        Ok(manifest)
    }

    pub fn rename_project(
        &self,
        project_id: &str,
        title: &str,
    ) -> Result<ProjectManifest, ProjectVaultError> {
        let title = normalized_title(title)?;
        let mut project = self.load_project(project_id)?;
        project.title = title.to_string();
        project.slug = slugify(title);
        project.updated_at_unix_ms = now_unix_ms();
        self.write_manifest(&project)?;
        Ok(project)
    }

    pub fn create_note(
        &self,
        project_id: &str,
        title: &str,
    ) -> Result<ProjectNote, ProjectVaultError> {
        let title = normalized_title(title)?;
        self.load_project(project_id)?;
        let now = now_unix_ms();
        let note_id = new_entity_id("note", project_id);
        self.write_note(project_id, &note_id, title, "", &[], now, now, None)
    }

    pub fn save_note(
        &self,
        project_id: &str,
        note_id: &str,
        title: &str,
        body_markdown: &str,
        tags: &[String],
    ) -> Result<ProjectNote, ProjectVaultError> {
        let title = normalized_title(title)?;
        self.load_project(project_id)?;
        let existing = self.load_note(project_id, note_id)?;
        self.write_note(
            project_id,
            note_id,
            title,
            body_markdown,
            tags,
            existing.created_at_unix_ms,
            now_unix_ms(),
            existing.legacy_note_id,
        )
    }

    /// Move a note file into the Project's `trash/` folder instead of
    /// deleting it outright. This keeps the action reversible from the
    /// filesystem for a short window while removing the note from the
    /// active Notes index immediately.
    pub fn delete_note(
        &self,
        project_id: &str,
        note_id: &str,
    ) -> Result<(), ProjectVaultError> {
        self.load_project(project_id)?;
        let path = self.note_path(project_id, note_id)?;
        if !path.exists() {
            return Err(ProjectVaultError::NoteNotFound(note_id.to_string()));
        }
        reject_symlink(&path)?;
        let trash_dir = self.project_dir(project_id)?.join("trash");
        reject_symlink(&trash_dir).ok();
        fs::create_dir_all(&trash_dir)?;
        let timestamp = now_unix_ms();
        let target = trash_dir.join(format!("{note_id}.{timestamp}.md"));
        fs::rename(&path, &target)?;
        Ok(())
    }

    pub fn load_note(
        &self,
        project_id: &str,
        note_id: &str,
    ) -> Result<ProjectNote, ProjectVaultError> {
        self.load_project(project_id)?;
        let path = self.note_path(project_id, note_id)?;
        if !path.exists() {
            return Err(ProjectVaultError::NoteNotFound(note_id.to_string()));
        }
        self.read_note_file(project_id, note_id, &path)
    }

    pub fn list_notes(&self, project_id: &str) -> Result<Vec<ProjectNote>, ProjectVaultError> {
        self.load_project(project_id)?;
        let notes_dir = self.notes_dir(project_id)?;
        reject_symlink(&notes_dir)?;
        let mut notes = Vec::new();
        for entry in fs::read_dir(notes_dir)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(ProjectVaultError::SymlinkNotAllowed(entry.path()));
            }
            if !file_type.is_file()
                || entry.path().extension().and_then(|value| value.to_str()) != Some("md")
            {
                continue;
            }
            let note_id = entry
                .path()
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| {
                    ProjectVaultError::InvalidFrontmatter("note filename is not UTF-8".to_string())
                })?
                .to_string();
            notes.push(self.read_note_file(project_id, &note_id, &entry.path())?);
        }
        notes.sort_by(|left, right| {
            right
                .updated_at_unix_ms
                .cmp(&left.updated_at_unix_ms)
                .then_with(|| left.title.cmp(&right.title))
        });
        Ok(notes)
    }

    pub fn migrate_legacy_notes(&self) -> Result<LegacyMigrationReport, ProjectVaultError> {
        let marker_path = self.legacy_migration_marker_path();
        if marker_path.exists() {
            reject_symlink(&marker_path)?;
            let marker: LegacyMigrationMarker = serde_json::from_slice(&fs::read(marker_path)?)?;
            validate_schema_version(marker.schema_version)?;
            return Ok(LegacyMigrationReport {
                status: LegacyMigrationStatus::AlreadyCompleted,
                migrated_note_count: marker.migrated_note_count,
                imported_project_id: Some(marker.imported_project_id),
                backup_vault_relative_path: Some(marker.backup_vault_relative_path),
                content_sha256: Some(marker.content_sha256),
            });
        }

        let legacy_notes = self.read_legacy_notes()?;
        if legacy_notes.is_empty() {
            return Ok(LegacyMigrationReport {
                status: LegacyMigrationStatus::NoLegacyNotes,
                migrated_note_count: 0,
                imported_project_id: None,
                backup_vault_relative_path: None,
                content_sha256: None,
            });
        }

        let content_sha256 = legacy_content_sha256(&legacy_notes);
        let backup_vault_relative_path =
            self.backup_legacy_index(&legacy_notes, &content_sha256)?;
        self.ensure_imported_project(&legacy_notes)?;

        for note in &legacy_notes {
            validate_entity_id("note", &note.note_id)?;
            self.write_note(
                IMPORTED_PROJECT_ID,
                &note.note_id,
                &note.title,
                &note.body_markdown,
                &[],
                note.updated_at_unix_ms,
                note.updated_at_unix_ms,
                Some(note.note_id.clone()),
            )?;
        }

        self.verify_legacy_migration(&legacy_notes, &content_sha256)?;
        let marker = LegacyMigrationMarker {
            schema_version: PROJECT_SCHEMA_VERSION,
            migration_id: "legacy-sqlite-notes-to-project-v1".to_string(),
            imported_project_id: IMPORTED_PROJECT_ID.to_string(),
            migrated_note_count: legacy_notes.len(),
            content_sha256: content_sha256.clone(),
            completed_at_unix_ms: now_unix_ms(),
            backup_vault_relative_path: backup_vault_relative_path.clone(),
        };
        write_json_atomic(&self.legacy_migration_marker_path(), &marker)?;

        Ok(LegacyMigrationReport {
            status: LegacyMigrationStatus::Migrated,
            migrated_note_count: legacy_notes.len(),
            imported_project_id: Some(IMPORTED_PROJECT_ID.to_string()),
            backup_vault_relative_path: Some(backup_vault_relative_path),
            content_sha256: Some(content_sha256),
        })
    }

    fn write_manifest(&self, project: &ProjectManifest) -> Result<(), ProjectVaultError> {
        validate_schema_version(project.schema_version)?;
        validate_entity_id("project", &project.project_id)?;
        validate_entity_id("note", &project.default_note_id)?;
        write_json_atomic(&self.project_manifest_path(&project.project_id)?, project)
    }

    #[allow(clippy::too_many_arguments)]
    fn write_note(
        &self,
        project_id: &str,
        note_id: &str,
        title: &str,
        body_markdown: &str,
        tags: &[String],
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
        legacy_note_id: Option<String>,
    ) -> Result<ProjectNote, ProjectVaultError> {
        validate_entity_id("project", project_id)?;
        validate_entity_id("note", note_id)?;
        let title = normalized_title(title)?;
        self.ensure_project_dirs(project_id)?;
        let tags = normalize_tags(tags);
        let frontmatter = ProjectNoteFrontmatter {
            schema_version: PROJECT_SCHEMA_VERSION,
            project_id: project_id.to_string(),
            note_id: note_id.to_string(),
            title: title.to_string(),
            slug: slugify(title),
            tags: tags.clone(),
            created_at_unix_ms,
            updated_at_unix_ms,
            legacy_note_id: legacy_note_id.clone(),
        };
        let yaml = serde_yaml::to_string(&frontmatter)?;
        let yaml = yaml.strip_prefix("---\n").unwrap_or(&yaml);
        let body_markdown = normalize_line_endings(body_markdown);
        let content = format!("---\n{yaml}---\n\n{body_markdown}");
        let path = self.note_path(project_id, note_id)?;
        atomic_replace(&path, content.as_bytes())?;
        Ok(ProjectNote {
            schema_version: PROJECT_SCHEMA_VERSION,
            project_id: project_id.to_string(),
            note_id: note_id.to_string(),
            title: title.to_string(),
            slug: slugify(title),
            tags,
            body_markdown,
            created_at_unix_ms,
            updated_at_unix_ms,
            legacy_note_id,
            vault_relative_path: note_relative_path(project_id, note_id),
        })
    }

    fn read_note_file(
        &self,
        project_id: &str,
        note_id: &str,
        path: &Path,
    ) -> Result<ProjectNote, ProjectVaultError> {
        validate_entity_id("project", project_id)?;
        validate_entity_id("note", note_id)?;
        reject_symlink(path)?;
        let content = normalize_line_endings(&fs::read_to_string(path)?);
        let rest = content.strip_prefix("---\n").ok_or_else(|| {
            ProjectVaultError::InvalidFrontmatter("missing opening delimiter".to_string())
        })?;
        let (yaml, body) = rest.split_once("\n---\n").ok_or_else(|| {
            ProjectVaultError::InvalidFrontmatter("missing closing delimiter".to_string())
        })?;
        let frontmatter: ProjectNoteFrontmatter = serde_yaml::from_str(yaml)?;
        validate_schema_version(frontmatter.schema_version)?;
        if frontmatter.project_id != project_id || frontmatter.note_id != note_id {
            return Err(ProjectVaultError::ManifestMismatch(format!(
                "note path {project_id}/{note_id} does not match frontmatter {}/{}",
                frontmatter.project_id, frontmatter.note_id
            )));
        }
        let body_markdown = body.strip_prefix('\n').unwrap_or(body).to_string();
        Ok(ProjectNote {
            schema_version: frontmatter.schema_version,
            project_id: frontmatter.project_id,
            note_id: frontmatter.note_id,
            title: frontmatter.title,
            slug: frontmatter.slug,
            tags: normalize_tags(&frontmatter.tags),
            body_markdown,
            created_at_unix_ms: frontmatter.created_at_unix_ms,
            updated_at_unix_ms: frontmatter.updated_at_unix_ms,
            legacy_note_id: frontmatter.legacy_note_id,
            vault_relative_path: note_relative_path(project_id, note_id),
        })
    }

    fn ensure_project_dirs(&self, project_id: &str) -> Result<(), ProjectVaultError> {
        validate_entity_id("project", project_id)?;
        reject_symlink(&self.layout.projects_dir())?;
        let project_dir = self.project_dir(project_id)?;
        reject_symlink(&project_dir)?;
        fs::create_dir_all(&project_dir)?;
        for name in ["notes", "sources", "concepts", "reviews", "activity"] {
            let path = project_dir.join(name);
            reject_symlink(&path)?;
            fs::create_dir_all(path)?;
        }
        Ok(())
    }

    fn ensure_imported_project(
        &self,
        legacy_notes: &[LearningNote],
    ) -> Result<(), ProjectVaultError> {
        let first_note = legacy_notes.first().ok_or_else(|| {
            ProjectVaultError::MigrationVerification(
                "legacy note set is unexpectedly empty".to_string(),
            )
        })?;
        let created_at = legacy_notes
            .iter()
            .map(|note| note.updated_at_unix_ms)
            .min()
            .unwrap_or(first_note.updated_at_unix_ms);
        let updated_at = legacy_notes
            .iter()
            .map(|note| note.updated_at_unix_ms)
            .max()
            .unwrap_or(first_note.updated_at_unix_ms);
        let manifest_path = self.project_manifest_path(IMPORTED_PROJECT_ID)?;
        if manifest_path.exists() {
            let existing = self.load_project(IMPORTED_PROJECT_ID)?;
            if existing.title != "Imported" {
                return Err(ProjectVaultError::ManifestMismatch(
                    "reserved imported project id is already in use".to_string(),
                ));
            }
            return Ok(());
        }
        self.ensure_project_dirs(IMPORTED_PROJECT_ID)?;
        self.write_manifest(&ProjectManifest {
            schema_version: PROJECT_SCHEMA_VERSION,
            project_id: IMPORTED_PROJECT_ID.to_string(),
            title: "Imported".to_string(),
            slug: "imported".to_string(),
            default_note_id: first_note.note_id.clone(),
            created_at_unix_ms: created_at,
            updated_at_unix_ms: updated_at,
        })
    }

    fn read_legacy_notes(&self) -> Result<Vec<LearningNote>, ProjectVaultError> {
        let index_path = self.layout.index_path();
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        reject_symlink(&index_path)?;
        read_legacy_notes_from_index(&index_path)
    }

    fn backup_legacy_index(
        &self,
        expected_notes: &[LearningNote],
        expected_hash: &str,
    ) -> Result<String, ProjectVaultError> {
        let source = self.layout.index_path();
        let backup = self.layout.backups_dir().join(LEGACY_BACKUP_FILE);
        reject_symlink(&source)?;
        reject_symlink(&backup)?;
        if !backup.exists() {
            copy_file_atomic(&source, &backup)?;
            for suffix in ["-wal", "-shm"] {
                let source_sidecar = PathBuf::from(format!("{}{suffix}", source.display()));
                if source_sidecar.exists() {
                    reject_symlink(&source_sidecar)?;
                    let backup_sidecar = PathBuf::from(format!("{}{suffix}", backup.display()));
                    reject_symlink(&backup_sidecar)?;
                    copy_file_atomic(&source_sidecar, &backup_sidecar)?;
                }
            }
        }

        let backup_notes = read_legacy_notes_from_index(&backup)?;
        let backup_hash = legacy_content_sha256(&backup_notes);
        if backup_notes.len() != expected_notes.len() || backup_hash != expected_hash {
            return Err(ProjectVaultError::MigrationVerification(format!(
                "legacy backup does not match source notes: expected {} notes/{expected_hash}, got {} notes/{backup_hash}",
                expected_notes.len(),
                backup_notes.len()
            )));
        }
        Ok(format!(".app/backups/{LEGACY_BACKUP_FILE}"))
    }

    fn verify_legacy_migration(
        &self,
        legacy_notes: &[LearningNote],
        expected_hash: &str,
    ) -> Result<(), ProjectVaultError> {
        let migrated = self.list_notes(IMPORTED_PROJECT_ID)?;
        let migrated_by_legacy_id = migrated
            .into_iter()
            .filter_map(|note| {
                note.legacy_note_id
                    .clone()
                    .map(|legacy_id| (legacy_id, note))
            })
            .collect::<std::collections::HashMap<_, _>>();
        if migrated_by_legacy_id.len() != legacy_notes.len() {
            return Err(ProjectVaultError::MigrationVerification(format!(
                "expected {} legacy notes but found {}",
                legacy_notes.len(),
                migrated_by_legacy_id.len()
            )));
        }
        let mut verified = Vec::with_capacity(legacy_notes.len());
        for legacy in legacy_notes {
            let migrated = migrated_by_legacy_id.get(&legacy.note_id).ok_or_else(|| {
                ProjectVaultError::MigrationVerification(format!(
                    "missing migrated note {}",
                    legacy.note_id
                ))
            })?;
            if migrated.title != legacy.title
                || migrated.body_markdown != normalize_line_endings(&legacy.body_markdown)
                || migrated.updated_at_unix_ms != legacy.updated_at_unix_ms
            {
                return Err(ProjectVaultError::MigrationVerification(format!(
                    "content mismatch for {}",
                    legacy.note_id
                )));
            }
            verified.push(LearningNote {
                note_id: migrated.note_id.clone(),
                title: migrated.title.clone(),
                body_markdown: migrated.body_markdown.clone(),
                updated_at_unix_ms: migrated.updated_at_unix_ms,
            });
        }
        verified.sort_by(|left, right| left.note_id.cmp(&right.note_id));
        let actual_hash = legacy_content_sha256(&verified);
        if actual_hash != expected_hash {
            return Err(ProjectVaultError::MigrationVerification(format!(
                "expected hash {expected_hash} but got {actual_hash}"
            )));
        }
        Ok(())
    }

    fn project_dir(&self, project_id: &str) -> Result<PathBuf, ProjectVaultError> {
        validate_entity_id("project", project_id)?;
        Ok(self.layout.projects_dir().join(project_id))
    }

    fn project_manifest_path(&self, project_id: &str) -> Result<PathBuf, ProjectVaultError> {
        Ok(self.project_dir(project_id)?.join(PROJECT_MANIFEST_FILE))
    }

    fn notes_dir(&self, project_id: &str) -> Result<PathBuf, ProjectVaultError> {
        Ok(self.project_dir(project_id)?.join("notes"))
    }

    fn note_path(&self, project_id: &str, note_id: &str) -> Result<PathBuf, ProjectVaultError> {
        validate_entity_id("note", note_id)?;
        Ok(self.notes_dir(project_id)?.join(format!("{note_id}.md")))
    }

    fn legacy_migration_marker_path(&self) -> PathBuf {
        self.layout.migrations_dir().join(LEGACY_MIGRATION_FILE)
    }
}

fn read_legacy_notes_from_index(index_path: &Path) -> Result<Vec<LearningNote>, ProjectVaultError> {
    reject_symlink(index_path)?;
    let connection = Connection::open_with_flags(index_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let table_exists: i64 = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'learning_notes')",
            [],
            |row| row.get(0),
        )?;
    if table_exists == 0 {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
            "SELECT note_id, title, body_markdown, updated_at_unix_ms FROM learning_notes ORDER BY note_id ASC",
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
        .map_err(ProjectVaultError::from)
}

fn normalized_title(title: &str) -> Result<&str, ProjectVaultError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(ProjectVaultError::EmptyTitle);
    }
    Ok(title)
}

fn validate_schema_version(actual: u32) -> Result<(), ProjectVaultError> {
    if actual != PROJECT_SCHEMA_VERSION {
        return Err(ProjectVaultError::UnsupportedSchemaVersion {
            actual,
            expected: PROJECT_SCHEMA_VERSION,
        });
    }
    Ok(())
}

pub(crate) fn validate_entity_id(kind: &'static str, value: &str) -> Result<(), ProjectVaultError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if !valid {
        return Err(ProjectVaultError::InvalidEntityId {
            kind,
            value: value.to_string(),
        });
    }
    Ok(())
}

fn new_entity_id(prefix: &str, seed: &str) -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    hasher.update(b"\0");
    hasher.update(seed.as_bytes());
    hasher.update(b"\0");
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(counter.to_le_bytes());
    let digest = hasher.finalize();
    let encoded = digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{prefix}_{encoded}")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_alphanumeric() {
            slug.push(character);
            last_was_separator = false;
        } else if !last_was_separator && !slug.is_empty() {
            slug.push('-');
            last_was_separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let value = tag.trim().to_lowercase();
        if !value.is_empty() && seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    normalized
}

fn normalize_line_endings(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

fn note_relative_path(project_id: &str, note_id: &str) -> String {
    format!("projects/{project_id}/notes/{note_id}.md")
}

fn legacy_content_sha256(notes: &[LearningNote]) -> String {
    let mut sorted = notes.to_vec();
    sorted.sort_by(|left, right| left.note_id.cmp(&right.note_id));
    let mut hasher = Sha256::new();
    for note in sorted {
        for value in [
            note.note_id,
            note.title,
            normalize_line_endings(&note.body_markdown),
            note.updated_at_unix_ms.to_string(),
        ] {
            hasher.update(value.as_bytes());
            hasher.update(b"\0");
        }
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), ProjectVaultError> {
    let mut content = serde_json::to_vec_pretty(value)?;
    content.push(b'\n');
    atomic_replace(path, &content)
}

fn atomic_replace(path: &Path, content: &[u8]) -> Result<(), ProjectVaultError> {
    let parent = path.parent().ok_or_else(|| {
        ProjectVaultError::ManifestMismatch(format!("path has no parent: {}", path.display()))
    })?;
    fs::create_dir_all(parent)?;
    reject_symlink(parent)?;
    reject_symlink(path)?;

    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            ProjectVaultError::ManifestMismatch("target filename is not UTF-8".to_string())
        })?;
    let unique = format!("{}-{}", std::process::id(), now_unix_nanos());
    let temporary = parent.join(format!(".{filename}.{unique}.tmp"));
    let backup = parent.join(format!(".{filename}.{unique}.bak"));

    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(content)?;
    file.sync_all()?;
    drop(file);

    if path.exists() {
        fs::rename(path, &backup)?;
        if let Err(error) = fs::rename(&temporary, path) {
            let _ = fs::rename(&backup, path);
            let _ = fs::remove_file(&temporary);
            return Err(ProjectVaultError::Io(error));
        }
        fs::remove_file(backup)?;
    } else {
        fs::rename(temporary, path)?;
    }
    sync_directory(parent)?;
    Ok(())
}

fn copy_file_atomic(source: &Path, target: &Path) -> Result<(), ProjectVaultError> {
    let parent = target.parent().ok_or_else(|| {
        ProjectVaultError::ManifestMismatch(format!(
            "backup path has no parent: {}",
            target.display()
        ))
    })?;
    fs::create_dir_all(parent)?;
    reject_symlink(source)?;
    reject_symlink(parent)?;
    reject_symlink(target)?;
    if target.exists() {
        return Ok(());
    }

    let filename = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            ProjectVaultError::ManifestMismatch("backup filename is not UTF-8".to_string())
        })?;
    let temporary = parent.join(format!(
        ".{filename}.{}-{}.tmp",
        std::process::id(),
        now_unix_nanos()
    ));
    fs::copy(source, &temporary)?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&temporary)?
        .sync_all()?;
    if let Err(error) = fs::rename(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(ProjectVaultError::Io(error));
    }
    sync_directory(parent)?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), ProjectVaultError> {
    #[cfg(not(target_os = "windows"))]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(target_os = "windows")]
    let _ = path;
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), ProjectVaultError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(ProjectVaultError::SymlinkNotAllowed(path.to_path_buf()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ProjectVaultError::Io(error)),
    }
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn now_unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{list_learning_notes, save_learning_note};

    #[test]
    fn creates_project_with_canonical_blank_note_and_expected_layout() {
        let root = test_vault_root("create-project");
        let vault = ProjectVault::initialize(&root).expect("vault should initialize");
        let snapshot = vault
            .create_project("Rust Systems")
            .expect("project should create");

        assert_eq!(snapshot.project.schema_version, PROJECT_SCHEMA_VERSION);
        assert_eq!(snapshot.project.title, "Rust Systems");
        assert_eq!(snapshot.default_note.body_markdown, "");
        assert_eq!(
            snapshot.default_note.note_id,
            snapshot.project.default_note_id
        );
        assert!(root
            .join(&snapshot.default_note.vault_relative_path)
            .exists());
        for directory in ["notes", "sources", "concepts", "reviews", "activity"] {
            assert!(root
                .join("projects")
                .join(&snapshot.project.project_id)
                .join(directory)
                .is_dir());
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_and_note_save_keep_stable_paths_and_normalize_tags() {
        let root = test_vault_root("stable-paths");
        let vault = ProjectVault::initialize(&root).expect("vault should initialize");
        let snapshot = vault
            .create_project("Original")
            .expect("project should create");
        let project_path = root.join("projects").join(&snapshot.project.project_id);
        let note_path = root.join(&snapshot.default_note.vault_relative_path);

        let renamed = vault
            .rename_project(&snapshot.project.project_id, "Renamed project")
            .expect("project should rename");
        let saved = vault
            .save_note(
                &snapshot.project.project_id,
                &snapshot.default_note.note_id,
                "Renamed note",
                "Line one\r\nLine two",
                &[" Rust ".to_string(), "rust".to_string(), "FTS".to_string()],
            )
            .expect("note should save");

        assert_eq!(renamed.project_id, snapshot.project.project_id);
        assert!(project_path.exists());
        assert_eq!(saved.note_id, snapshot.default_note.note_id);
        assert_eq!(
            saved.vault_relative_path,
            snapshot.default_note.vault_relative_path
        );
        assert_eq!(saved.body_markdown, "Line one\nLine two");
        assert_eq!(saved.tags, vec!["rust".to_string(), "fts".to_string()]);
        assert!(note_path.exists());
        assert!(fs::read_to_string(note_path)
            .expect("note should read")
            .starts_with("---\nschemaVersion: 1\n"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_path_traversal_identifiers() {
        let root = test_vault_root("path-safety");
        let vault = ProjectVault::initialize(&root).expect("vault should initialize");
        let result = vault.load_project("../outside");
        assert!(matches!(
            result,
            Err(ProjectVaultError::InvalidEntityId { .. })
        ));
        let result = vault.note_path("project_safe", "..\\outside");
        assert!(matches!(
            result,
            Err(ProjectVaultError::InvalidEntityId { .. })
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migrates_legacy_notes_once_and_preserves_legacy_database() {
        let root = test_vault_root("legacy-migration");
        save_learning_note(&root, "First", "First body").expect("legacy note should save");
        save_learning_note(&root, "Second", "Second body").expect("legacy note should save");
        let legacy_before = list_learning_notes(&root).expect("legacy notes should list");
        let vault = ProjectVault::initialize(&root).expect("vault should initialize");

        let first = vault
            .migrate_legacy_notes()
            .expect("migration should succeed");
        let second = vault
            .migrate_legacy_notes()
            .expect("second migration should succeed");

        assert_eq!(first.status, LegacyMigrationStatus::Migrated);
        assert_eq!(first.migrated_note_count, 2);
        assert_eq!(second.status, LegacyMigrationStatus::AlreadyCompleted);
        assert_eq!(second.migrated_note_count, 2);
        assert!(root.join(".app/backups").join(LEGACY_BACKUP_FILE).exists());
        assert!(root
            .join(".app/migrations")
            .join(LEGACY_MIGRATION_FILE)
            .exists());
        let imported = vault
            .list_notes(IMPORTED_PROJECT_ID)
            .expect("imported notes should list");
        assert_eq!(imported.len(), 2);
        assert!(imported.iter().all(|note| note.legacy_note_id.is_some()));
        assert_eq!(
            list_learning_notes(&root).expect("legacy DB should remain"),
            legacy_before
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_legacy_store_does_not_create_marker_or_project() {
        let root = test_vault_root("empty-legacy");
        let vault = ProjectVault::initialize(&root).expect("vault should initialize");
        let report = vault
            .migrate_legacy_notes()
            .expect("migration should succeed");

        assert_eq!(report.status, LegacyMigrationStatus::NoLegacyNotes);
        assert!(!root
            .join(".app/migrations")
            .join(LEGACY_MIGRATION_FILE)
            .exists());
        assert!(!root.join("projects").join(IMPORTED_PROJECT_ID).exists());

        let _ = fs::remove_dir_all(root);
    }

    fn test_vault_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "learn-alone-project-vault-{name}-{}",
            now_unix_nanos()
        ))
    }
}
