use std::io;
use std::path::PathBuf;

use local_knowledge_core::VaultLayout;

pub fn initialize_vault(root: PathBuf) -> io::Result<PathBuf> {
    let layout = VaultLayout::new(root);
    layout.ensure_dirs()?;
    Ok(layout.root().to_path_buf())
}
