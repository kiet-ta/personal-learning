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
async fn generate_knowledge_draft_with_llm(
    config_json: String,
    prompt: String,
    source_context: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::generate_knowledge_draft_with_llm(
        config_json,
        prompt,
        source_context,
    )
    .await
}

#[tauri::command]
async fn answer_review_question_with_llm(
    config_json: String,
    question: String,
    source_context: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::answer_review_question_with_llm(
        config_json,
        question,
        source_context,
    )
    .await
}

#[tauri::command]
async fn suggest_relations_with_llm(
    config_json: String,
    nodes_json: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::suggest_relations_with_llm(config_json, nodes_json).await
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
fn create_project(vault_root: String, title: String) -> Result<String, String> {
    local_knowledge_tauri_commands::create_project(PathBuf::from(vault_root), title)
}

#[tauri::command]
fn list_projects(vault_root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::list_projects(PathBuf::from(vault_root))
}

#[tauri::command]
fn get_project(vault_root: String, project_id: String) -> Result<String, String> {
    local_knowledge_tauri_commands::get_project(PathBuf::from(vault_root), project_id)
}

#[tauri::command]
fn rename_project(vault_root: String, project_id: String, title: String) -> Result<String, String> {
    local_knowledge_tauri_commands::rename_project(PathBuf::from(vault_root), project_id, title)
}

#[tauri::command]
fn create_project_note(
    vault_root: String,
    project_id: String,
    title: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::create_project_note(
        PathBuf::from(vault_root),
        project_id,
        title,
    )
}

#[tauri::command]
fn save_project_note(
    vault_root: String,
    project_id: String,
    note_id: String,
    title: String,
    body_markdown: String,
    tags_json: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::save_project_note(
        PathBuf::from(vault_root),
        project_id,
        note_id,
        title,
        body_markdown,
        tags_json,
    )
}

#[tauri::command]
fn list_project_notes(vault_root: String, project_id: String) -> Result<String, String> {
    local_knowledge_tauri_commands::list_project_notes(PathBuf::from(vault_root), project_id)
}

#[tauri::command]
fn migrate_legacy_workspace(vault_root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::migrate_legacy_workspace(PathBuf::from(vault_root))
}

#[tauri::command]
fn save_ai_suggestions(vault_root: String, suggestions_json: String) -> Result<String, String> {
    local_knowledge_tauri_commands::save_ai_suggestions(PathBuf::from(vault_root), suggestions_json)
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

#[tauri::command]
fn persist_approved_node(
    vault_root: String,
    node_id: String,
    title: String,
    summary: String,
    body_markdown: String,
    tags_json: String,
    source_anchor: String,
    relation_type: String,
) -> Result<String, String> {
    local_knowledge_tauri_commands::persist_approved_node(
        PathBuf::from(vault_root),
        node_id,
        title,
        summary,
        body_markdown,
        tags_json,
        source_anchor,
        relation_type,
    )
}

#[tauri::command]
fn list_persisted_nodes_cmd(vault_root: String) -> Result<String, String> {
    local_knowledge_tauri_commands::list_persisted_nodes_cmd(PathBuf::from(vault_root))
}

#[tauri::command]
fn delete_persisted_node_cmd(vault_root: String, node_id: String) -> Result<String, String> {
    local_knowledge_tauri_commands::delete_persisted_node_cmd(PathBuf::from(vault_root), node_id)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            initialize_vault,
            generate_knowledge_draft,
            generate_knowledge_draft_from_source,
            generate_knowledge_draft_with_llm,
            answer_review_question_with_llm,
            suggest_relations_with_llm,
            ingest_sources,
            analyze_sources,
            save_note,
            list_notes,
            create_project,
            list_projects,
            get_project,
            rename_project,
            create_project_note,
            save_project_note,
            list_project_notes,
            migrate_legacy_workspace,
            save_ai_suggestions,
            list_ai_suggestions,
            record_suggestion_decision,
            persist_approved_node,
            list_persisted_nodes_cmd,
            delete_persisted_node_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
