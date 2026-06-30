# Project Vault Schema v1

## Layout

```text
projects/<project_id>/
  project.json
  notes/<note_id>.md
  sources/
  concepts/
  reviews/
  activity/
.app/
  backups/index-before-project-v1.sqlite
  migrations/project-v1.json
.trash/
```

IDs are ASCII alphanumeric plus `_` or `-`, at most 128 bytes. Titles and
slugs never participate in managed paths.

## Project manifest

```json
{
  "schemaVersion": 1,
  "projectId": "project_0123456789abcdef",
  "title": "Distributed Systems",
  "slug": "distributed-systems",
  "defaultNoteId": "note_0123456789abcdef",
  "createdAtUnixMs": 1782748800000,
  "updatedAtUnixMs": 1782748800000
}
```

## Canonical Note

```markdown
---
schemaVersion: 1
projectId: project_0123456789abcdef
noteId: note_0123456789abcdef
title: CAP theorem
slug: cap-theorem
tags:
- distributed-systems
- consistency
createdAtUnixMs: 1782748800000
updatedAtUnixMs: 1782748800000
---

# CAP theorem
```

The body may be empty. App writes normalize line endings to LF and tags to
trimmed lowercase values with stable first-seen order.

## Legacy migration

`migrate_legacy_workspace` performs:

1. Return the existing completion marker when already migrated.
2. Read `learning_notes` using a read-only SQLite connection.
3. Preserve the SQLite database and any WAL/SHM sidecars under `.app/backups/`.
4. Write Notes into the reserved `project_imported_legacy` Project.
5. Re-read migrated Notes and verify count plus SHA-256 over identity/content.
6. Write `.app/migrations/project-v1.json` only after verification succeeds.

The migration does not modify or delete legacy rows.
