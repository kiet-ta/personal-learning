# Local Knowledge App

Desktop-first, local-first personal learning knowledge graph app for Windows
and macOS.

Read these first:

1. `AGENTS.md` for agent operating rules.
2. `CONTEXT.md` for project context and hard constraints.
3. `plan.md` for the six-month SDLC plan.
4. `idea.md` for research and trade-off background.

## Current State

This repository is in Phase 1 bootstrap:

- Agent context is configured.
- Project context is documented.
- Target monorepo directories are present.
- Text/Markdown document worker baseline is implemented.
- Rust core/Tauri command skeleton is present.
- Desktop React/Tauri shell has Note, Graph, and Review workspaces.
- Flutter companion shell skeleton is present.
- Rust core tests and desktop web build pass.
- AI-generated graph relations are stored as pending suggestions and require
  user approval before becoming canonical graph edges.
- macOS production release requires Apple signing/notarization credentials; see
  `docs/release/macos-production.md`.
- Flutter `pub get` / `doctor` currently time out in this environment.

## MVP Direction

- Windows and macOS desktop apps are the source of truth.
- Flutter mobile is a companion.
- PDF/text/Markdown/image only.
- Vault + SQLite/SQLCipher.
- FTS before semantic search.
- No cloud sync, collaboration, full CRDT, or audio/video in MVP.

## First Verification

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/test-worker.ps1
```

Start the desktop web shell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/desktop-dev.ps1
```

Build the desktop web shell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/desktop-build.ps1
```
"# personal-learning" 
