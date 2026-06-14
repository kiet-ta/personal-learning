use std::path::PathBuf;

#[tauri::command]
fn initialize_vault(root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::initialize_vault(PathBuf::from(root))
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![initialize_vault])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
