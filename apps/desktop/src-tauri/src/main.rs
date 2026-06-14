use std::path::PathBuf;

#[tauri::command]
fn initialize_vault(root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::initialize_vault(PathBuf::from(root))
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn generate_knowledge_draft(prompt: String) -> Result<String, String> {
    local_knowledge_tauri_commands::generate_knowledge_draft(prompt)
}

#[tauri::command]
fn generate_knowledge_draft_from_source(
    source_name: String,
    content: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::generate_knowledge_draft_from_source(source_name, content)
}

#[tauri::command]
fn ingest_sources(vault_root: String, sources_json: String) -> Result<String, String> {
    local_knowledge_tauri_commands::ingest_sources(PathBuf::from(vault_root), sources_json)
}

#[tauri::command]
fn analyze_sources(vault_root: String, query: String) -> Result<String, String> {
    local_knowledge_tauri_commands::analyze_sources(PathBuf::from(vault_root), query)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            initialize_vault,
            generate_knowledge_draft,
            generate_knowledge_draft_from_source,
            ingest_sources,
            analyze_sources
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
