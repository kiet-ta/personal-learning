//! Internal helpers shared across `node_persistence` and
//! `source_versions`. Kept crate-private so we don't widen the public
//! surface for a small atomic-write concern.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use crate::node_persistence::NodePersistenceError;

pub(crate) fn node_persistence_like_write(
    target: &Path,
    content: &[u8],
) -> Result<(), NodePersistenceError> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let filename = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            NodePersistenceError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "target filename is not UTF-8",
            ))
        })?;
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let unique = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let temporary = parent.join(format!(".{filename}.{unique}.tmp"));

    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(content)?;
    file.sync_all()?;
    drop(file);

    if target.exists() {
        let backup = parent.join(format!(".{filename}.{unique}.bak"));
        let _ = std::fs::rename(target, &backup);
        if std::fs::rename(&temporary, target).is_err() {
            let _ = std::fs::remove_file(&temporary);
            return Err(NodePersistenceError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("failed to replace {}", target.display()),
            )));
        }
        let _ = std::fs::remove_file(&backup);
    } else if let Err(error) = std::fs::rename(&temporary, target) {
        let _ = std::fs::remove_file(&temporary);
        return Err(NodePersistenceError::Io(error));
    }
    Ok(())
}