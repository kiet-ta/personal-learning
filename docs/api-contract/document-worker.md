# Document Worker Contract

Status: implemented for text/Markdown baseline.

## CLI

```powershell
$env:PYTHONPATH="workers/document_worker/src"
python -m document_worker.cli <path> --pretty
```

## Supported Inputs

| Extension | Modality | Status |
|---|---|---|
| `.txt` | `text` | Implemented |
| `.md` | `markdown` | Implemented |
| `.markdown` | `markdown` | Implemented |
| `.pdf` | `pdf` | Planned |
| image formats | `image` | Planned |

Unsupported extensions return a non-zero CLI exit with a JSON error.

## Output Shape

```json
{
  "source_asset": {
    "asset_id": "asset_<hash>",
    "sha256": "hex",
    "filename": "lesson.md",
    "mime_type": "text/markdown",
    "modality": "markdown",
    "size_bytes": 123
  },
  "nodes": [
    {
      "node_id": "node_<hash>",
      "title": "Normalization",
      "body": "Markdown body",
      "summary": "Short summary",
      "source_anchor": {
        "source_file": "lesson.md",
        "start_line": 10,
        "end_line": 18,
        "start_offset": 120,
        "end_offset": 640,
        "section_path": ["Databases", "Normalization"]
      },
      "node_reason": "markdown_heading_or_paragraph_boundary"
    }
  ],
  "conversion_tool": "document_worker.text_markdown.v1"
}
```

## Boundary Rules

- The worker does not write to the vault yet.
- The worker must preserve source anchors for every node.
- The worker must reject unsupported media rather than silently parsing it.
- PDF/OCR support must be added behind the same output contract.
