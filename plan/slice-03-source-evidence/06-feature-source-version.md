# Feature 06 — SourceVersion + SourceVersionRegistry

## Intent

A Project owns zero or more Sources. Each Source has one or more
immutable Source Versions, identified by `(project_id, source_id,
version_id)`. Ingesting the same `source_id` again creates a new
`version_kind = "updated"` version while preserving the prior file
on disk.

## Status

✅ Implemented in commit pending.

## Affected files

- `crates/core/src/source_versions.rs` (new)
- `crates/core/src/atomic_write.rs` (new shared helper)
- `crates/core/src/node_persistence.rs` (delegates to atomic_write)
- `crates/core/src/lib.rs` (modules + re-exports)

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| One Markdown file per Source Version under `projects/<id>/sources/` | Same as `nodes/` | Reuses project vault layout | Safe filenames; `.tmp + .bak + rename` | O(1) per version | User can browse/copy versions |
| `version_id` is `v_<unix_ms>_<n>` where `n` is the existing count for that source | Predictable | Easy to grep | Distinct | Negligible | Short, readable |
| Hash = full SHA-256 of normalized content | Standard | Stable across OS | Stronger than truncated | O(content) | Stable |

## Diagnose loop outcome

- **Loop:** `cargo test -p local_knowledge_core`.
- **Predicted:** Initial version on first ingest; subsequent same
  `source_id` ingest creates Updated version and preserves the older
  file on disk.
- **Confirmation:** `source_versions::tests` cover both paths.