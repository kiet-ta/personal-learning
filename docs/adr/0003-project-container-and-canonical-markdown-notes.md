# ADR-0003: Project Container and Canonical Markdown Notes

Status: Accepted on 2026-06-30.

## Context

The UI previously presented Notes as if they were Projects, while Note content
was stored in SQLite. That contradicted the local-first rule that the
filesystem vault is canonical and made project-scoped Graph, Review, Sources,
Evidence, metrics, and PET context ambiguous.

## Decision

A Project is a real container stored at `projects/<project_id>/`, where the
folder uses a stable generated ID and `project.json` stores `schemaVersion`,
title, display slug, timestamps, and the default Note ID. User Notes are
canonical Markdown at `notes/<note_id>.md`; title, slug, tags, timestamps, and
identity live in YAML frontmatter. SQLite remains a rebuildable index and
legacy metadata store.

Legacy SQLite Notes migrate idempotently into a reserved `Imported` Project.
Migration first preserves a database backup, writes deterministic Note paths,
verifies count and content hash, then writes a completion marker. It never
deletes or rewrites the legacy table during the first migration.

## Consequences

- Renaming a Project or Note cannot break graph, evidence, or review identity.
- Sources, Concepts, Review Runs, and Learning Events have an unambiguous
  Project owner and will move behind the same Project seam in later slices.
- The desktop UI must complete an explicit cutover before migration is invoked
  automatically; until then legacy commands remain compatibility-only.
