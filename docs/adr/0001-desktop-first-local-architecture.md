# ADR-0001: Desktop-First Local Architecture

Date: 2026-06-12

## Status

Accepted for MVP planning. ADR-0002 expands the platform target from
Windows-first to Windows and macOS desktop.

## Context

The project targets a private personal learning workflow. The highest-value
properties are local ownership, source traceability, offline usefulness, and a
controlled six-month MVP scope.

The source documents establish that trying to ship a full agent platform, cloud
sync, collaboration, CRDTs, audio/video ingest, and a complex plugin system in
MVP would make the plan unscalable for the team and timeline.

## Decision

Build a desktop knowledge workstation as the canonical product. The original
MVP planning target was Windows-first; ADR-0002 expands production desktop
support to Windows and macOS.
Use a Flutter mobile companion only for capture, review, and lightweight search.

Adopt:

- Tauri + React/TypeScript for desktop UI.
- Rust core for vault, metadata, sync, graph, search, review, and crypto
  boundaries.
- SQLite first, SQLCipher where app-level encryption is needed.
- Filesystem Markdown vault as canonical storage.
- Document worker for PDF/text/image/OCR outside the UI process.
- FTS search before semantic search.

## Consequences

Positive:

- Clear source of truth.
- Lower operational cost and no mandatory backend.
- Better privacy story.
- Easier backup/export/rebuild because the vault is inspectable.
- Smaller MVP surface area.

Negative:

- Desktop packaging and native dependencies need careful setup.
- Mobile cannot be a full offline editor in MVP.
- Sync must be carefully designed to avoid data loss.
- Local parsing quality and Windows packaging become critical delivery risks.

## Non-Goals

- Cloud sync.
- Multi-user collaboration.
- Full CRDT.
- Full mobile graph editor.
- Audio/video ingest.
- Plugin marketplace.
- OpenClaw as core runtime dependency.
