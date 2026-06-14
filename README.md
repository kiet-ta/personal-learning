# Local Knowledge App

Desktop-first, local-first personal learning knowledge graph app.

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
- Desktop React/Tauri shell skeleton is present.
- Flutter companion shell skeleton is present.
- Rust/Cargo and npm dependencies still need local toolchain setup before full
  builds can run.

## MVP Direction

- Windows desktop is the source of truth.
- Flutter mobile is a companion.
- PDF/text/Markdown/image only.
- Vault + SQLite/SQLCipher.
- FTS before semantic search.
- No cloud sync, collaboration, full CRDT, or audio/video in MVP.

## First Verification

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/test-worker.ps1
```
"# personal-learning" 
