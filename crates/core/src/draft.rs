use std::collections::HashMap;
use std::error::Error;
use std::fmt;

const MAX_PROMPT_CHARS: usize = 16_000;
const MAX_DRAFT_NODES: usize = 4;
const SUPPORTED_SOURCE_EXTENSIONS: &[&str] = &["txt", "md", "markdown"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnowledgeDraft {
    pub source_name: String,
    pub nodes: Vec<DraftNode>,
    pub edges: Vec<DraftEdge>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftNode {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub confidence: u8,
    pub relation_type: DraftRelationType,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DraftRelationType {
    Source,
    Prerequisite,
    Supports,
    Contrasts,
}

impl DraftRelationType {
    pub fn as_label(&self) -> &'static str {
        match self {
            Self::Source => "Source",
            Self::Prerequisite => "Prerequisite",
            Self::Supports => "Supports",
            Self::Contrasts => "Contrasts",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftSourceChunk {
    pub source_name: String,
    pub text: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DraftError {
    EmptyPrompt,
    PromptTooLarge { actual_chars: usize, max_chars: usize },
    InvalidSourceName,
    UnsupportedSourceType { source_name: String },
}

impl fmt::Display for DraftError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPrompt => write!(formatter, "Prompt is empty."),
            Self::PromptTooLarge {
                actual_chars,
                max_chars,
            } => write!(
                formatter,
                "Prompt has {actual_chars} characters, exceeding the {max_chars} character limit."
            ),
            Self::InvalidSourceName => write!(formatter, "Source filename is invalid."),
            Self::UnsupportedSourceType { source_name } => {
                write!(formatter, "Unsupported source type for {source_name}.")
            }
        }
    }
}

impl Error for DraftError {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TextUnit {
    text: String,
    start_line: u32,
    end_line: u32,
}

pub fn generate_knowledge_draft(prompt: &str) -> Result<KnowledgeDraft, DraftError> {
    generate_knowledge_draft_from_source("prompt-draft.md", prompt)
}

pub fn generate_knowledge_draft_from_source(
    source_name: &str,
    content: &str,
) -> Result<KnowledgeDraft, DraftError> {
    let source_name = sanitize_source_name(source_name)?;
    if !is_supported_source_name(&source_name) {
        return Err(DraftError::UnsupportedSourceType { source_name });
    }

    generate_knowledge_draft_with_source(&source_name, content)
}

pub fn generate_knowledge_draft_from_source_chunks(
    chunks: &[DraftSourceChunk],
) -> Result<KnowledgeDraft, DraftError> {
    if chunks.is_empty() {
        return Err(DraftError::EmptyPrompt);
    }

    let combined = chunks
        .iter()
        .map(|chunk| chunk.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = combined.trim();
    if trimmed.is_empty() {
        return Err(DraftError::EmptyPrompt);
    }

    let actual_chars = trimmed.chars().count();
    if actual_chars > MAX_PROMPT_CHARS {
        return Err(DraftError::PromptTooLarge {
            actual_chars,
            max_chars: MAX_PROMPT_CHARS,
        });
    }

    let global_tags = top_tags(trimmed, 5);
    let nodes: Vec<DraftNode> = chunks
        .iter()
        .take(MAX_DRAFT_NODES)
        .enumerate()
        .map(|(index, chunk)| {
            let unit = TextUnit {
                text: chunk.text.clone(),
                start_line: chunk.start_line,
                end_line: chunk.end_line,
            };
            build_node(&chunk.source_name, index, &[unit], &global_tags)
        })
        .collect();
    let edges = build_edges(&nodes);

    Ok(KnowledgeDraft {
        source_name: "rag-analysis.md".to_string(),
        nodes,
        edges,
    })
}

fn generate_knowledge_draft_with_source(
    source_name: &str,
    prompt: &str,
) -> Result<KnowledgeDraft, DraftError> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(DraftError::EmptyPrompt);
    }

    let actual_chars = trimmed.chars().count();
    if actual_chars > MAX_PROMPT_CHARS {
        return Err(DraftError::PromptTooLarge {
            actual_chars,
            max_chars: MAX_PROMPT_CHARS,
        });
    }

    let units = extract_text_units(trimmed);
    let chunks = group_units(&units);
    let global_tags = top_tags(trimmed, 5);

    let nodes: Vec<DraftNode> = chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| build_node(source_name, index, chunk, &global_tags))
        .collect();

    let edges = build_edges(&nodes);

    Ok(KnowledgeDraft {
        source_name: source_name.to_string(),
        nodes,
        edges,
    })
}

fn extract_text_units(prompt: &str) -> Vec<TextUnit> {
    let mut units = Vec::new();

    for (line_index, line) in prompt.lines().enumerate() {
        let line_number = (line_index + 1) as u32;
        let mut sentence = String::new();

        for character in line.chars() {
            sentence.push(character);

            if matches!(character, '.' | '!' | '?' | ';') {
                push_unit(&mut units, &sentence, line_number, line_number);
                sentence.clear();
            }
        }

        push_unit(&mut units, &sentence, line_number, line_number);
    }

    if units.is_empty() {
        units.push(TextUnit {
            text: prompt.to_string(),
            start_line: 1,
            end_line: prompt.lines().count().max(1) as u32,
        });
    }

    units
}

fn push_unit(units: &mut Vec<TextUnit>, sentence: &str, start_line: u32, end_line: u32) {
    let text = sentence.trim();
    if text.is_empty() {
        return;
    }

    units.push(TextUnit {
        text: text.to_string(),
        start_line,
        end_line,
    });
}

fn group_units(units: &[TextUnit]) -> Vec<Vec<TextUnit>> {
    if units.len() <= MAX_DRAFT_NODES {
        return units.iter().cloned().map(|unit| vec![unit]).collect();
    }

    let chunk_size = units.len().div_ceil(MAX_DRAFT_NODES);
    units
        .chunks(chunk_size)
        .take(MAX_DRAFT_NODES)
        .map(|chunk| chunk.to_vec())
        .collect()
}

fn build_node(
    source_name: &str,
    index: usize,
    chunk: &[TextUnit],
    global_tags: &[String],
) -> DraftNode {
    let body = chunk
        .iter()
        .map(|unit| unit.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let title = title_from_text(&body, index);
    let mut tags = top_tags(&body, 3);
    for tag in global_tags {
        if tags.len() >= 3 {
            break;
        }
        if !tags.contains(tag) {
            tags.push(tag.clone());
        }
    }
    if tags.is_empty() {
        tags.push("learning".to_string());
    }

    let start_line = chunk.first().map(|unit| unit.start_line).unwrap_or(1);
    let end_line = chunk.last().map(|unit| unit.end_line).unwrap_or(start_line);
    let relation_type = relation_type_for(index, &body);

    DraftNode {
        id: format!("draft-{:03}-{}", index + 1, slugify(&title)),
        title,
        summary: compact_text(&body, 190),
        tags,
        confidence: confidence_for(&body, index),
        relation_type,
        source: format!("{source_name}:{start_line}-{end_line}"),
    }
}

fn sanitize_source_name(source_name: &str) -> Result<String, DraftError> {
    let trimmed = source_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
    {
        return Err(DraftError::InvalidSourceName);
    }

    Ok(trimmed.to_string())
}

fn is_supported_source_name(source_name: &str) -> bool {
    let Some((_, extension)) = source_name.rsplit_once('.') else {
        return false;
    };

    SUPPORTED_SOURCE_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
}

fn build_edges(nodes: &[DraftNode]) -> Vec<DraftEdge> {
    let mut edges: Vec<DraftEdge> = nodes
        .windows(2)
        .enumerate()
        .map(|(index, pair)| {
            let label = match pair[1].relation_type {
                DraftRelationType::Prerequisite => "requires",
                DraftRelationType::Contrasts => "contrasts",
                DraftRelationType::Source | DraftRelationType::Supports => "supports",
            };

            DraftEdge {
                id: format!("edge-{:03}", index + 1),
                from: pair[0].id.clone(),
                to: pair[1].id.clone(),
                label: label.to_string(),
            }
        })
        .collect();

    if nodes.len() > 2 {
        edges.push(DraftEdge {
            id: format!("edge-{:03}", edges.len() + 1),
            from: nodes[0].id.clone(),
            to: nodes[nodes.len() - 1].id.clone(),
            label: "frames".to_string(),
        });
    }

    edges
}

fn relation_type_for(index: usize, text: &str) -> DraftRelationType {
    if index == 0 {
        return DraftRelationType::Source;
    }

    let lowered = text.to_lowercase();
    // Use explicit contrast markers; avoid "but" which is too common in supporting context
    if contains_any(
        &lowered,
        &["however", "on the other hand", "in contrast", "in spite of", "despite"],
    ) || lowered.contains("but ")
    {
        DraftRelationType::Contrasts
    } else if contains_any(
        &lowered,
        &["before ", "requires ", "prerequisite", "in order to", "depends on"],
    ) {
        DraftRelationType::Prerequisite
    } else {
        DraftRelationType::Supports
    }
}

fn confidence_for(text: &str, index: usize) -> u8 {
    let word_count = text.split_whitespace().count();
    let structure_bonus = if text.contains(':') || text.contains('-') {
        4
    } else {
        0
    };
    let length_bonus = word_count.min(18) as u8;
    let position_penalty = (index as u8).saturating_mul(2);

    68_u8
        .saturating_add(length_bonus)
        .saturating_add(structure_bonus)
        .saturating_sub(position_penalty)
        .min(94)
}

fn title_from_text(text: &str, index: usize) -> String {
    let words: Vec<String> = normalized_words(text)
        .into_iter()
        .filter(|word| !is_stop_word(word))
        .take(6)
        .collect();

    if words.is_empty() {
        return format!("Knowledge node {}", index + 1);
    }

    let mut title = words.join(" ");
    if let Some(first) = title.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    compact_text(&title, 64)
}

fn compact_text(text: &str, max_chars: usize) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }

    let mut compact = String::new();
    for word in normalized.split_whitespace() {
        let next_len = compact.chars().count() + word.chars().count() + usize::from(!compact.is_empty());
        if next_len > max_chars.saturating_sub(1) {
            break;
        }
        if !compact.is_empty() {
            compact.push(' ');
        }
        compact.push_str(word);
    }
    compact.push_str("...");
    compact
}

fn top_tags(text: &str, limit: usize) -> Vec<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for word in normalized_words(text) {
        if word.chars().count() < 4 || is_stop_word(&word) {
            continue;
        }
        *counts.entry(word).or_default() += 1;
    }

    let mut ranked: Vec<(String, usize)> = counts.into_iter().collect();
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    ranked
        .into_iter()
        .take(limit)
        .map(|(word, _)| word)
        .collect()
}

fn normalized_words(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_alphanumeric())
        .filter_map(|word| {
            let normalized = word.trim().to_lowercase();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        })
        .collect()
}

fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;

    for character in text.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "node".to_string()
    } else {
        trimmed.to_string()
    }
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn is_stop_word(word: &str) -> bool {
    matches!(
        word,
        "about"
            | "after"
            | "also"
            | "and"
            | "are"
            | "because"
            | "better"
            | "can"
            | "cho"
            | "concept"
            | "each"
            | "from"
            | "have"
            | "into"
            | "khi"
            | "main"
            | "mot"
            | "một"
            | "nhung"
            | "nhưng"
            | "note"
            | "notes"
            | "only"
            | "should"
            | "that"
            | "the"
            | "this"
            | "to"
            | "trong"
            | "user"
            | "và"
            | "voi"
            | "với"
            | "when"
            | "with"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_prompt() {
        let error = generate_knowledge_draft("   ").expect_err("empty prompt should fail");
        assert_eq!(error, DraftError::EmptyPrompt);
    }

    #[test]
    fn creates_draft_nodes_and_edges_from_prompt() {
        let draft = generate_knowledge_draft(
            "Spaced repetition improves long-term memory. Retrieval practice exposes weak spots. But vague notes are hard to review.",
        )
        .expect("prompt should generate a draft");

        assert_eq!(draft.source_name, "prompt-draft.md");
        assert_eq!(draft.nodes.len(), 3);
        assert_eq!(draft.edges.len(), 3);
        assert_eq!(draft.nodes[0].relation_type, DraftRelationType::Source);
        assert_eq!(draft.nodes[2].relation_type, DraftRelationType::Contrasts);
        assert!(draft.nodes[0].source.starts_with("prompt-draft.md:"));
    }

    #[test]
    fn creates_draft_from_named_source() {
        let draft = generate_knowledge_draft_from_source(
            "operating-systems.md",
            "Scheduling decides which process runs next.\nPreemption can interrupt a running process.",
        )
        .expect("named source should generate a draft");

        assert_eq!(draft.source_name, "operating-systems.md");
        assert!(draft
            .nodes
            .iter()
            .all(|node| node.source.starts_with("operating-systems.md:")));
    }

    #[test]
    fn rejects_unsafe_source_names() {
        let error = generate_knowledge_draft_from_source("../notes.md", "content")
            .expect_err("unsafe filename should fail");

        assert_eq!(error, DraftError::InvalidSourceName);
    }

    #[test]
    fn rejects_unsupported_source_types() {
        let error = generate_knowledge_draft_from_source("lecture.pdf", "content")
            .expect_err("unsupported filename should fail");

        assert_eq!(
            error,
            DraftError::UnsupportedSourceType {
                source_name: "lecture.pdf".to_string()
            }
        );
    }

    #[test]
    fn creates_draft_from_source_chunks_with_original_anchors() {
        let draft = generate_knowledge_draft_from_source_chunks(&[
            DraftSourceChunk {
                source_name: "memory.md".to_string(),
                text: "Retrieval practice strengthens recall.".to_string(),
                start_line: 3,
                end_line: 5,
            },
            DraftSourceChunk {
                source_name: "systems.md".to_string(),
                text: "Scheduling policies decide process execution order.".to_string(),
                start_line: 10,
                end_line: 12,
            },
        ])
        .expect("chunks should produce a draft");

        assert_eq!(draft.source_name, "rag-analysis.md");
        assert_eq!(draft.nodes[0].source, "memory.md:3-5");
        assert_eq!(draft.nodes[1].source, "systems.md:10-12");
    }

    #[test]
    fn rejects_oversized_prompt() {
        let prompt = "a".repeat(MAX_PROMPT_CHARS + 1);
        let error = generate_knowledge_draft(&prompt).expect_err("oversized prompt should fail");
        assert_eq!(
            error,
            DraftError::PromptTooLarge {
                actual_chars: MAX_PROMPT_CHARS + 1,
                max_chars: MAX_PROMPT_CHARS
            }
        );
    }
}
