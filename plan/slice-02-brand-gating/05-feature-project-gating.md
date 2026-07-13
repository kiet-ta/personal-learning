# Feature 05 — Disable Note / Graph / Review / Add Sources / Generate Nodes when no active Project

## Intent

Per `plan.md` locked product decision: before a Project is selected,
the workspace pages and the topbar primary actions remain visible but
disabled. They re-enable the moment a Project is opened.

## Status

✅ Implemented in commit pending.

## Affected files

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | `workspaceTabs.map(...)` now computes `requiresProject = page === note | graph | review` and binds `disabled`. "Add sources" label and "Generate nodes" button read `hasActiveProject` and short-circuit if it is false. |

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Show disabled tabs (not hide them) | Same | One render path | N/A | Trivial | User learns what becomes available |
| Status banner on disabled click | Same | Reuses `setStatusMessage` | N/A | Trivial | Discoverable |
| Disable hidden `<input type="file">` directly | Same | Browsers honor `disabled` | Avoids accidentally triggering ingest before a project exists | Trivial | Native UX |

## Diagnose loop outcome

- **Loop:** TS compile + click-guard code review.
- **Predicted behavior:** before `create_project`, the tabs dim and
  click handlers short-circuit; after a successful
  `create_project`/`handleSelectProject`, all five UI affordances
  re-enable.
- **Confirmation:** by construction (TS clean).