use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultLayout {
    root: PathBuf,
}

impl VaultLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn inbox_dir(&self) -> PathBuf {
        self.root.join("inbox")
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn nodes_dir(&self) -> PathBuf {
        self.root.join("nodes")
    }

    pub fn projects_dir(&self) -> PathBuf {
        self.root.join("projects")
    }

    pub fn trash_dir(&self) -> PathBuf {
        self.root.join(".trash")
    }

    pub fn app_dir(&self) -> PathBuf {
        self.root.join(".app")
    }

    pub fn index_path(&self) -> PathBuf {
        self.app_dir().join("index.sqlite")
    }

    pub fn migrations_dir(&self) -> PathBuf {
        self.app_dir().join("migrations")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.app_dir().join("backups")
    }

    pub fn ensure_dirs(&self) -> io::Result<()> {
        fs::create_dir_all(self.inbox_dir())?;
        fs::create_dir_all(self.assets_dir())?;
        fs::create_dir_all(self.nodes_dir())?;
        fs::create_dir_all(self.projects_dir())?;
        fs::create_dir_all(self.trash_dir())?;
        fs::create_dir_all(self.app_dir())?;
        fs::create_dir_all(self.migrations_dir())?;
        fs::create_dir_all(self.backups_dir())?;
        Ok(())
    }

    pub fn resolve_safe_relative(&self, relative: impl AsRef<Path>) -> Option<PathBuf> {
        let relative = relative.as_ref();
        if !is_safe_relative_path(relative) {
            return None;
        }
        Some(self.root.join(relative))
    }
}

pub fn is_safe_relative_path(path: &Path) -> bool {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return false;
    }

    path.components().all(|component| {
        matches!(
            component,
            Component::Normal(_) | Component::CurDir
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_absolute_and_parent_paths() {
        assert!(!is_safe_relative_path(Path::new("../secret.txt")));
        assert!(!is_safe_relative_path(Path::new("/absolute.txt")));
        assert!(!is_safe_relative_path(Path::new("")));
    }

    #[test]
    fn accepts_nested_relative_paths() {
        assert!(is_safe_relative_path(Path::new("assets/file.pdf")));
        assert!(is_safe_relative_path(Path::new("./nodes/topic.md")));
        assert!(is_safe_relative_path(Path::new("projects/project_123/notes/note_123.md")));
    }

    #[test]
    fn resolves_only_safe_relative_paths() {
        let layout = VaultLayout::new("vault");
        assert_eq!(
            layout.resolve_safe_relative("assets/file.pdf"),
            Some(PathBuf::from("vault").join("assets/file.pdf"))
        );
        assert_eq!(layout.resolve_safe_relative("../outside"), None);
    }
}
