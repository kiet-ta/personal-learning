use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt;

// ── Config ────────────────────────────────────────────────────────────────

/// LLM provider configuration passed from the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: String,
}

// ── Request / Response types ──────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Message {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelEntry>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelEntry {
    name: String,
}

// ── LLM draft response types ──────────────────────────────────────────────

/// Parsed JSON response from LLM for node generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmDraftResponse {
    pub nodes: Vec<LlmDraftNode>,
    pub edges: Vec<LlmDraftEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmDraftNode {
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    #[serde(rename = "relationType")]
    pub relation_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmDraftEdge {
    pub from: usize,
    pub to: usize,
    pub label: String,
}

/// Parsed JSON response from LLM for relation suggestions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmSuggestionResponse {
    pub suggestions: Vec<LlmSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmSuggestion {
    #[serde(rename = "fromNodeId")]
    pub from_node_id: String,
    #[serde(rename = "toNodeId")]
    pub to_node_id: String,
    #[serde(rename = "relationKind")]
    pub relation_kind: String,
    pub rationale: String,
    pub confidence: u8,
}

// ── Errors ────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum LlmError {
    EmptyApiKey,
    HttpError(String),
    ParseError(String),
    NoChoices,
    JsonParseError(String),
}

impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyApiKey => write!(f, "API key is empty. Configure it in Settings > LLM Configuration."),
            Self::HttpError(msg) => write!(f, "LLM HTTP error: {msg}"),
            Self::ParseError(msg) => write!(f, "LLM response parse error: {msg}"),
            Self::NoChoices => write!(f, "LLM returned no response choices."),
            Self::JsonParseError(msg) => write!(f, "Failed to parse LLM JSON output: {msg}"),
        }
    }
}

impl Error for LlmError {}

// ── Public API ────────────────────────────────────────────────────────────

/// Providers that run locally and don't require an API key (Ollama has no
/// auth at all; a generic "Local API" endpoint like llama.cpp usually doesn't
/// either). "Custom" endpoints may or may not need a key — the Bearer header
/// is only attached when a key is present, so the endpoint decides.
pub fn provider_requires_api_key(provider: &str) -> bool {
    !matches!(provider, "Ollama" | "Local API" | "Custom")
}

/// Build the OpenAI-compatible endpoint URL from config.
fn build_url(config: &LlmConfig) -> String {
    if !config.base_url.is_empty() {
        let trimmed = config.base_url.trim_end_matches('/');
        format!("{trimmed}/chat/completions")
    } else {
        match config.provider.as_str() {
            "OpenAI" => "https://api.openai.com/v1/chat/completions".into(),
            "Anthropic" => "https://api.anthropic.com/v1/chat/completions".into(),
            "OpenRouter" => "https://openrouter.ai/api/v1/chat/completions".into(),
            "Google Gemini" => {
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".into()
            }
            "Azure OpenAI" => {
                // Azure requires base_url; fallback to a generic placeholder
                "https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT/chat/completions?api-version=2024-02-15-preview".into()
            }
            "Ollama" => "http://localhost:11434/v1/chat/completions".into(),
            _ => format!("{}/chat/completions", config.base_url),
        }
    }
}

/// Call an OpenAI-compatible chat completion API.
pub async fn call_llm(
    config: &LlmConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, LlmError> {
    if provider_requires_api_key(&config.provider) && config.api_key.trim().is_empty() {
        return Err(LlmError::EmptyApiKey);
    }

    let url = build_url(config);
    let body = ChatCompletionRequest {
        model: config.model.clone(),
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: system_prompt.into(),
            },
            ChatMessage {
                role: "user".into(),
                content: user_prompt.into(),
            },
        ],
        temperature: 0.3,
        max_tokens: 4096,
    };

    let client = reqwest::Client::new();
    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json");
    if !config.api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", config.api_key.trim()));
    }
    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| LlmError::HttpError(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(LlmError::HttpError(format!(
            "HTTP {status}: {error_text}"
        )));
    }

    let data: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|e| LlmError::ParseError(e.to_string()))?;

    data.choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .ok_or(LlmError::NoChoices)
}

/// Fetch the tags of locally pulled models from a running Ollama instance,
/// using Ollama's native `/api/tags` endpoint (not the OpenAI-compatible
/// surface, which has no model-listing route).
pub async fn list_ollama_models(base_url: &str) -> Result<Vec<String>, LlmError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let root = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    let root = if root.is_empty() {
        "http://localhost:11434"
    } else {
        root
    };
    let url = format!("{root}/api/tags");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| LlmError::HttpError(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(LlmError::HttpError(format!(
            "HTTP {status}: {error_text}"
        )));
    }

    let data: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| LlmError::ParseError(e.to_string()))?;

    Ok(data.models.into_iter().map(|m| m.name).collect())
}

// ── System prompts ────────────────────────────────────────────────────────

pub const SYSTEM_PROMPT_GENERATE_NODES: &str = r#"You are a knowledge extraction assistant. Given a text, extract key learning concepts as atomic knowledge nodes.

Return ONLY valid JSON with this exact structure (no markdown, no code fences):
{
  "nodes": [
    {
      "title": "string (concise title, max 60 chars)",
      "summary": "string (max 200 chars)",
      "tags": ["tag1", "tag2"],
      "relationType": "Source | Prerequisite | Supports | Contrasts"
    }
  ],
  "edges": [
    {
      "from": 0,
      "to": 1,
      "label": "supports | requires | contrasts"
    }
  ]
}

Rules:
- Each node must be atomic (one concept per node).
- Generate 2-6 nodes depending on content density.
- "Source" for the first/foundational node, "Prerequisite" for foundational concepts, "Supports" for reinforcing concepts, "Contrasts" for opposing viewpoints.
- Edge labels: "supports", "requires", or "contrasts".
- The "from" and "to" fields are 0-based indices into the nodes array."#;

pub const SYSTEM_PROMPT_REVIEW: &str = r#"You are a study assistant. Answer the user's question based ONLY on the provided source chunks.

Rules:
- Cite your sources using the format [SourceName:line-start-line-end].
- If the sources don't contain enough information to answer, say so clearly.
- Be concise and educational.
- Do not invent information not present in the sources."#;

pub const SYSTEM_PROMPT_SUGGEST_RELATIONS: &str = r#"You are a knowledge graph analyst. Given a list of knowledge nodes, suggest meaningful relationships between them.

Return ONLY valid JSON with this exact structure (no markdown, no code fences):
{
  "suggestions": [
    {
      "fromNodeId": "string (the node id provided)",
      "toNodeId": "string (the node id provided)",
      "relationKind": "supports | requires | contrasts | extends | example-of",
      "rationale": "string (brief explanation, max 100 chars)",
      "confidence": 85
    }
  ]
}

Rules:
- Only suggest relationships that are semantically meaningful.
- Confidence should be 0-100 integer.
- Generate 1-5 suggestions."#;

// ── Convenience wrappers ──────────────────────────────────────────────────

/// Generate knowledge nodes from a prompt using LLM.
/// Returns the raw JSON string from the LLM.
pub async fn generate_nodes_with_llm(
    config: &LlmConfig,
    prompt: &str,
    source_context: &str,
) -> Result<String, LlmError> {
    let user_prompt = if source_context.is_empty() {
        format!("Extract knowledge nodes from this text:\n\n{prompt}")
    } else {
        format!(
            "Extract knowledge nodes from this text:\n\n{prompt}\n\nRelevant source chunks:\n{source_context}"
        )
    };
    call_llm(config, SYSTEM_PROMPT_GENERATE_NODES, &user_prompt).await
}

/// Answer a review question using LLM with source chunks as context.
pub async fn answer_review_question(
    config: &LlmConfig,
    question: &str,
    source_context: &str,
) -> Result<String, LlmError> {
    let user_prompt = if source_context.is_empty() {
        format!("Question: {question}\n\nNo sources are available.")
    } else {
        format!("Question: {question}\n\n{source_context}")
    };
    call_llm(config, SYSTEM_PROMPT_REVIEW, &user_prompt).await
}

/// Generate relation suggestions between nodes using LLM.
pub async fn suggest_relations_with_llm(
    config: &LlmConfig,
    nodes_json: &str,
) -> Result<String, LlmError> {
    let user_prompt = format!(
        "Suggest relationships between these knowledge nodes:\n\n{nodes_json}"
    );
    call_llm(config, SYSTEM_PROMPT_SUGGEST_RELATIONS, &user_prompt).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_url_default_openai() {
        let config = LlmConfig {
            provider: "OpenAI".into(),
            model: "gpt-4.1".into(),
            api_key: "sk-test".into(),
            base_url: "".into(),
        };
        assert_eq!(build_url(&config), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_build_url_openrouter() {
        let config = LlmConfig {
            provider: "OpenRouter".into(),
            model: "openai/gpt-4.1".into(),
            api_key: "sk-test".into(),
            base_url: "".into(),
        };
        assert_eq!(build_url(&config), "https://openrouter.ai/api/v1/chat/completions");
    }

    #[test]
    fn test_build_url_custom_base() {
        let config = LlmConfig {
            provider: "Local API".into(),
            model: "llama3.2".into(),
            api_key: "ollama".into(),
            base_url: "http://localhost:11434/v1".into(),
        };
        assert_eq!(build_url(&config), "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn test_build_url_custom_base_trailing_slash() {
        let config = LlmConfig {
            provider: "Local API".into(),
            model: "llama3.2".into(),
            api_key: "ollama".into(),
            base_url: "http://localhost:11434/v1/".into(),
        };
        assert_eq!(build_url(&config), "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn test_llm_error_display_empty_key() {
        let err = LlmError::EmptyApiKey;
        assert!(err.to_string().contains("API key is empty"));
    }

    #[test]
    fn test_build_url_ollama_default() {
        let config = LlmConfig {
            provider: "Ollama".into(),
            model: "llama3.2:3b".into(),
            api_key: "".into(),
            base_url: "".into(),
        };
        assert_eq!(build_url(&config), "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn test_build_url_ollama_custom_base() {
        let config = LlmConfig {
            provider: "Ollama".into(),
            model: "llama3.2:3b".into(),
            api_key: "".into(),
            base_url: "http://192.168.1.10:11434/v1".into(),
        };
        assert_eq!(
            build_url(&config),
            "http://192.168.1.10:11434/v1/chat/completions"
        );
    }

    #[test]
    fn test_provider_requires_api_key() {
        assert!(!provider_requires_api_key("Ollama"));
        assert!(!provider_requires_api_key("Local API"));
        assert!(!provider_requires_api_key("Custom"));
        assert!(provider_requires_api_key("OpenAI"));
        assert!(provider_requires_api_key("Anthropic"));
    }

    #[test]
    fn test_build_url_anthropic_default() {
        let config = LlmConfig {
            provider: "Anthropic".into(),
            model: "claude-sonnet-4-5".into(),
            api_key: "sk-ant-test".into(),
            base_url: "".into(),
        };
        assert_eq!(
            build_url(&config),
            "https://api.anthropic.com/v1/chat/completions"
        );
    }

    #[test]
    fn test_build_url_custom_provider() {
        let config = LlmConfig {
            provider: "Custom".into(),
            model: "deepseek-chat".into(),
            api_key: "sk-test".into(),
            base_url: "https://api.deepseek.com/v1".into(),
        };
        assert_eq!(
            build_url(&config),
            "https://api.deepseek.com/v1/chat/completions"
        );
    }
}
