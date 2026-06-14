from __future__ import annotations

import mimetypes
import re
from pathlib import Path

from .hashing import sha256_file, sha256_text
from .models import KnowledgeNode, ParseResult, SourceAnchor, SourceAsset

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt"}
MAX_WORDS_PER_NODE = 380
MIN_WORDS_FOR_SPLIT = 80
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


def parse_document(path: str | Path) -> ParseResult:
    source_path = Path(path)
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    if source_path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ValueError(f"Unsupported document type: {source_path.suffix}")

    raw_text = source_path.read_text(encoding="utf-8-sig", errors="replace")
    normalized_text = _normalize_text(raw_text)
    digest = sha256_file(source_path)
    source_asset = SourceAsset(
        asset_id=f"asset_{digest[:16]}",
        sha256=digest,
        filename=source_path.name,
        mime_type=_detect_mime_type(source_path),
        modality=_detect_modality(source_path),
        size_bytes=source_path.stat().st_size,
    )
    nodes = _build_nodes(
        text=normalized_text,
        source_file=source_path.name,
        source_sha256=digest,
    )
    return ParseResult(
        source_asset=source_asset,
        nodes=nodes,
        conversion_tool="document_worker.text_markdown.v1",
    )


def _normalize_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def _detect_mime_type(path: Path) -> str:
    detected, _ = mimetypes.guess_type(path.name)
    if detected:
        return detected
    if path.suffix.lower() in {".md", ".markdown"}:
        return "text/markdown"
    return "text/plain"


def _detect_modality(path: Path) -> str:
    if path.suffix.lower() in {".md", ".markdown"}:
        return "markdown"
    return "text"


def _build_nodes(text: str, source_file: str, source_sha256: str) -> list[KnowledgeNode]:
    if not text:
        return []

    line_starts = _line_starts(text)
    sections = _split_sections(text)
    nodes: list[KnowledgeNode] = []
    for section in sections:
        chunks = _split_section_body(section["body"])
        for chunk_index, chunk in enumerate(chunks):
            if not chunk["body"].strip():
                continue
            start_offset = section["start_offset"] + chunk["start_offset"]
            end_offset = section["start_offset"] + chunk["end_offset"]
            start_line = _offset_to_line(line_starts, start_offset)
            end_line = _offset_to_line(line_starts, max(start_offset, end_offset - 1))
            title = section["title"]
            if len(chunks) > 1:
                title = f"{title} ({chunk_index + 1})"
            body = chunk["body"].strip()
            section_path = section["section_path"]
            node_id = _stable_node_id(
                source_sha256=source_sha256,
                title=title,
                start_offset=start_offset,
                end_offset=end_offset,
            )
            nodes.append(
                KnowledgeNode(
                    node_id=node_id,
                    title=title,
                    body=body,
                    summary=_summarize(body),
                    source_anchor=SourceAnchor(
                        source_file=source_file,
                        start_line=start_line,
                        end_line=end_line,
                        start_offset=start_offset,
                        end_offset=end_offset,
                        section_path=section_path,
                    ),
                    node_reason="markdown_heading_or_paragraph_boundary",
                )
            )
    return nodes


def _split_sections(text: str) -> list[dict[str, object]]:
    matches = list(HEADING_RE.finditer(text))
    if not matches:
        return [
            {
                "title": "Untitled",
                "body": text,
                "start_offset": 0,
                "section_path": ["Untitled"],
            }
        ]

    sections: list[dict[str, object]] = []
    path_stack: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        level = len(match.group(1))
        title = match.group(2).strip()
        body_start = match.end()
        body_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        path_stack = [(existing_level, name) for existing_level, name in path_stack if existing_level < level]
        path_stack.append((level, title))
        section_path = [name for _, name in path_stack]
        body = text[body_start:body_end].strip()
        if not body:
            continue
        sections.append(
            {
                "title": title,
                "body": body,
                "start_offset": body_start + _leading_whitespace_len(text[body_start:body_end]),
                "section_path": section_path,
            }
        )
    return sections


def _split_section_body(body: object) -> list[dict[str, object]]:
    value = str(body)
    paragraphs = list(_paragraphs_with_offsets(value))
    if not paragraphs:
        return []

    chunks: list[dict[str, object]] = []
    current_parts: list[str] = []
    current_start = paragraphs[0][0]
    current_end = paragraphs[0][1]
    current_words = 0

    for start, end, paragraph in paragraphs:
        paragraph_words = _word_count(paragraph)
        should_flush = (
            current_parts
            and current_words >= MIN_WORDS_FOR_SPLIT
            and current_words + paragraph_words > MAX_WORDS_PER_NODE
        )
        if should_flush:
            chunks.append(
                {
                    "body": "\n\n".join(current_parts),
                    "start_offset": current_start,
                    "end_offset": current_end,
                }
            )
            current_parts = []
            current_start = start
            current_words = 0

        current_parts.append(paragraph.strip())
        current_end = end
        current_words += paragraph_words

    if current_parts:
        chunks.append(
            {
                "body": "\n\n".join(current_parts),
                "start_offset": current_start,
                "end_offset": current_end,
            }
        )
    return chunks


def _paragraphs_with_offsets(text: str) -> list[tuple[int, int, str]]:
    paragraphs: list[tuple[int, int, str]] = []
    for match in re.finditer(r"\S(?:.*?\S)?(?=\n\s*\n|\Z)", text, flags=re.DOTALL):
        paragraph = match.group(0).strip()
        if paragraph:
            start = match.start() + _leading_whitespace_len(match.group(0))
            end = match.end()
            paragraphs.append((start, end, paragraph))
    return paragraphs


def _line_starts(text: str) -> list[int]:
    starts = [0]
    for index, char in enumerate(text):
        if char == "\n":
            starts.append(index + 1)
    return starts


def _offset_to_line(line_starts: list[int], offset: int) -> int:
    line = 1
    for index, line_start in enumerate(line_starts, start=1):
        if line_start > offset:
            break
        line = index
    return line


def _leading_whitespace_len(text: str) -> int:
    return len(text) - len(text.lstrip())


def _word_count(text: str) -> int:
    return len(re.findall(r"\w+", text, flags=re.UNICODE))


def _stable_node_id(source_sha256: str, title: str, start_offset: int, end_offset: int) -> str:
    value = f"{source_sha256}:{title}:{start_offset}:{end_offset}"
    return f"node_{sha256_text(value)[:20]}"


def _summarize(body: str) -> str:
    compact = re.sub(r"\s+", " ", body).strip()
    if len(compact) <= 180:
        return compact
    return f"{compact[:177].rstrip()}..."
