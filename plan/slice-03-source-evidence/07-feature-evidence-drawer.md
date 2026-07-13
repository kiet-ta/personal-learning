# Feature 07 — Evidence Locator + detail drawer

## Intent

An Evidence Locator is a typed, checksummed location inside a Source
Version: line and character range for Markdown/text. The UI exposes
an Evidence detail drawer so users can confirm the cited slice matches
their source.

## Status

✅ Implemented in commit pending.

## Affected files

- `crates/core/src/source_versions.rs` (`build_evidence_locator`)
- `crates/tauri_commands/src/lib.rs` (`build_evidence_locator_cmd`)
- `apps/desktop/src/App.tsx` (Evidence detail drawer in Note rail)

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Locator carries `source_version_id`, never raw path | Decouples UI from FS layout | One stable reference | Survives renames | O(1) lookup | Older citations stay valid |
| Excerpt computed on demand from line range | Cheap | No DB duplication | N/A | O(line count) | User sees actual cited text |
| Drawer opens on demand, not modal | Same | One panel in the rail | N/A | Trivial | Calm utilitarian UX |

## Diagnose loop outcome

- **Loop:** `cargo test -p local_knowledge_core` covers
  `evidence_locator_captures_line_range`.
- **Confirmation:** test passes; UI wires it from the rail button.