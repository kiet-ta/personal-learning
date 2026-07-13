# Slice 3 — Project-owned Source Versions + Evidence Detail Drawer

## Why this slice exists

`plan.md` locks:

> A Source belongs to one Project. Imports are managed snapshots;
> updates create immutable Source Versions.

> AI relations require Evidence before approval. Manual relations
> require a user rationale and are marked manual.

This slice implements the storage-side guarantees so Slice 4's
review/graph work can cite exact, unchanging Source Versions.

## Features

| # | Feature | Status |
|---|---|---|
| 06 | `source_versions.rs` module + `SourceVersion` struct + `SourceVersionRegistry` (ingest/list/read) | ✅ implemented |
| 07 | `EvidenceLocator` + `build_evidence_locator()` and React Evidence detail drawer | ✅ implemented |
| 08 | Tauri commands (`ingest_project_source`, `list_project_source_versions`, `build_evidence_locator_cmd`) | ✅ implemented |
| 09 | React UI: project-scoped Source Versions panel in Note rail | ✅ implemented |

## Affected files

| File | Change |
|---|---|
| `crates/core/src/atomic_write.rs` | New shared atomic-write helper. |
| `crates/core/src/source_versions.rs` | SourceVersion + registry + Evidence locator + tests. |
| `crates/core/src/node_persistence.rs` | Delegates atomic write to `atomic_write`. |
| `crates/core/src/lib.rs` | Module + re-export. |
| `crates/tauri_commands/src/lib.rs` | DTOs + handlers. |
| `apps/desktop/src-tauri/src/main.rs` | Command registration. |
| `apps/desktop/src/App.tsx` | Project-source panel, evidence drawer, ingest path. |

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Source Version stored as Markdown with YAML frontmatter under `projects/<id>/sources/` | Good for 10k+ versions | Reuses project_vault conventions | Same vault-boundary checks apply | O(file) per version | User can inspect/audit each version |
| Versioning via SHA + monotonic counter | Cheap | Predictable | Older versions cannot mutate | O(1) ingest | Older citations stay valid |
| Evidence Locator captured per call (no DB storage) | Same | No schema coupling | N/A | O(content scan) | UI computes excerpt on demand |
| Legacy `assets/` + FTS path kept for drafts | Allows incremental cutover | One branch to retire in Slice 4 | Same | Same | Two rails: one for citations, one for search |

## Diagnose loop outcome

- **Loop:** `cargo test -p local_knowledge_core` + `npm run build`.
- **Predicted behavior:** `ingest_project_source` mints an Initial
  SourceVersion, second call with the same `source_id` mints an
  Updated version and keeps the prior file on disk.
- **Confirmation:** 71 tests pass (4 new), TS clean.

## Multi-model review verdict

Pending — folded into Slice 3 review pass.