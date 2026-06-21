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

#[tauri::command]
fn save_note(vault_root: String, title: String, body_markdown: String) -> Result<String, String> {
    local_knowledge_tauri_commands::save_note(PathBuf::from(vault_root), title, body_markdown)
}

#[tauri::command]
fn list_notes(vault_root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::list_notes(PathBuf::from(vault_root))
}

#[tauri::command]
fn save_ai_suggestions(vault_root: String, suggestions_json: String) -> Result<String, String> {
    local_knowledge_tauri_commands::save_ai_suggestions(
        PathBuf::from(vault_root),
        suggestions_json,
    )
}

#[tauri::command]
fn list_ai_suggestions(vault_root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::list_ai_suggestions(PathBuf::from(vault_root))
}

#[tauri::command]
fn record_suggestion_decision(
    vault_root: String,
    suggestion_id: String,
    status: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::record_suggestion_decision(
        PathBuf::from(vault_root),
        suggestion_id,
        status,
    )
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            initialize_vault,
            generate_knowledge_draft,
            generate_knowledge_draft_from_source,
            ingest_sources,
            analyze_sources,
            save_note,
            list_notes,
            save_ai_suggestions,
            list_ai_suggestions,
            record_suggestion_decision
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
