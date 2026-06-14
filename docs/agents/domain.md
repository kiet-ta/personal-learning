# Domain Docs Convention

This repo uses a single-context documentation layout.

## Required Reads

Agents must read:

1. `AGENTS.md`
2. `CONTEXT.md`
3. Relevant ADRs under `docs/adr/`
4. `plan.md` when planning sprint scope, backlog, release gates, or team work

## ADR Location

Architectural decisions live under:

```txt
docs/adr/
```

Use ADRs for changes to:

- Storage and vault format
- SQLite/SQLCipher schema
- Sync contracts
- Security posture
- Worker boundaries
- Search/retrieval architecture
- Mobile/desktop ownership rules

## Context Rules

- `CONTEXT.md` defines the project language and hard constraints.
- Keep domain terms stable across code, docs, issues, and tests.
- If implementation changes a hard rule, update `CONTEXT.md` and add or revise
  an ADR in the same change.
