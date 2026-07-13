# Feature 02 — Project-scoped Tauri commands surfaced in UI

## Intent

React `App.tsx` must consume the project-scoped commands the Rust core
already exposes (`list_projects`, `list_project_notes`, `create_project`,
`create_project_note`, `save_project_note`, `migrate_legacy_workspace`).
After this feature lands, `list_notes` and `save_note` are no longer
referenced from the React UI.

## Status

✅ Implemented in commit `f70f6c4` alongside the runtime migration.

## Affected files

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | Project types + project state + `handleCreateProject` / `handleSelectProject`; replaces list_notes/save_note calls with project-scoped commands; syncs project notes back into the legacy `notes` view so the rest of the UI keeps working unchanged. |

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Two parallel data shapes (`notes` legacy, `projectNotes` new) during the cutover | One is dropped next slice | Lets us cut over without rewriting every Notes UI reference in one go | No regression | One extra re-render on project change | User sees Notes open in the new Project |
| `useEffect` rehydration of `projectNotes -> notes` | O(n) | One place owns it | N/A | Fast for MVP corpus | Invisible to user |
| Lazy create of first Note on save | Same | Fewest API surface differences | Rust enforces invariants | Single extra IPC | User saves → note persisted |

## Diagnose loop outcome

- **Loop:** `cargo test -p local_knowledge_core` (Rust) + `npm run build` (TS+Vite).
- **Repro:** before this commit, App.tsx called legacy `list_notes` which
  is dead-by-Slice-1-gate per plan.md.
- **Hypotheses (ranked):**
  1. Legacy `list_notes` would still return old rows → would mask Project cutover.
     Mitigation: removed.
  2. New project loads might be empty → we populate from default note.
  3. Editing body before project select → gate in `handleSaveNote`.
- **Confirmation:** TS clean, all 63 Rust tests pass, bundle unchanged size.

## Multi-model review verdict

Pending — to run alongside Slice 2/3 review.
