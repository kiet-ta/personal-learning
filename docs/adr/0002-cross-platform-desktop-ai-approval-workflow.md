# ADR-0002: Cross-Platform Desktop and AI Approval Workflow

Date: 2026-06-21

## Status

Accepted for implementation.

## Context

The project started as Windows-first because Windows desktop is the primary
development environment and source of truth. The product direction now requires
the same canonical desktop app to run on macOS as a production downloadable app.

The learning workflow also needs a richer product surface:

- A Note workspace for source upload and slash-command note taking.
- A Graph workspace with roadmap-style knowledge nodes and a right sidebar.
- A Review workspace with a NotebookLM-style prompt grounded in local sources.
- A Settings surface for Account settings and provider-agnostic LLM
  configuration.
- AI-generated nodes and related-node suggestions.

AI suggestions can be useful, but incorrect graph edges would corrupt the user's
learning map if accepted automatically.

## Decision

Keep the product desktop-first and local-first, but expand the desktop target to
Windows and macOS.

Adopt this AI workflow:

1. Notes and uploaded sources are persisted to the local vault/index boundary.
2. Retrieval uses local indexed source chunks first.
3. AI providers may generate draft nodes and relation suggestions.
4. AI-generated relations are saved as pending suggestions.
5. The user must approve a suggestion before it becomes a canonical graph edge.
6. Rejections are persisted as feedback and must not silently reappear as
   approved edges.

Adopt this UI structure:

- `Note`: source upload, note list, slash-command editor.
- `Graph`: 2.5D roadmap-style graph, node sidebar, pending approval queue.
- `Review`: prompt/chat workspace with source citations and study actions.
- `Settings`: Account settings and Personal LLM configuration (BYOK) for
  OpenAI, Anthropic, Azure OpenAI, Gemini, OpenRouter, or a local API.

API keys must not be stored in plaintext project files, logs, or vault content.
Production key persistence must use OS secure storage or Tauri Stronghold.

## Consequences

Positive:

- macOS becomes a first-class product target without changing the local-first
  ownership model.
- AI can reduce manual graph work without being allowed to silently mutate the
  canonical graph.
- The app workflow maps more directly to user behavior: capture, organize,
  approve, review.

Negative:

- macOS production distribution adds signing and notarization requirements.
- AI provider abstraction requires careful secret handling and provider-specific
  error management.
- The approval queue introduces more state and UI complexity.
- A slash-command editor improves UX, but a full block editor will eventually
  need deeper persistence semantics than a plain textarea.

## Production macOS Requirement

A production macOS release requires Apple Developer Program credentials,
signing certificates, and notarization secrets in CI or a trusted release
machine. Unsigned ad-hoc builds are acceptable for internal development only and
do not satisfy the production distribution requirement.

## Non-Goals

- No cloud sync as a side effect of macOS support.
- No automatic AI commit of graph edges.
- No plaintext API key persistence.
- No OpenClaw or third-party community skill runtime inside the trusted core.
