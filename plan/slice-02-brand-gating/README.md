# Slice 2 — StudyNote Brand + Project Gating + Workspace-by-Project

## Why this slice exists

`plan.md` addendum locks two product rules:

> Before a Project is selected, `Note`, `Review`, `Graph`, Add Sources,
> and Generate Nodes remain visible but disabled.
>
> Opening a Project enters Note and every new Project creates one blank
> Note.

This slice applies the StudyNote product name (per locked addendum) and
the gating rule.

## Features

| # | Feature | Status |
|---|---|---|
| 04 | Apply StudyNote brand in topbar (replace legacy `ReMind`) | ✅ implemented |
| 05 | Disable Note/Graph/Review tabs and Add Sources / Generate Nodes buttons when no active Project | ✅ implemented |

## Affected files

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | Brand string; tab `disabled` attribute + click guard; source-button + generate-nodes button gating; CSS class hint `disabled`. |

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Tabs remain visible when disabled (not hidden) | Same | One render path | N/A | Trivial | User knows what becomes available after creating a Project |
| Status message on disabled click | Same | Single line | N/A | Trivial | Discoverable without a tooltip |
| Hidden `<input type="file">` keeps its onChange guard | Same | One extra check | Avoids accidental IPC before a project exists | Trivial | Click is the only path that runs upload |

## Diagnose loop outcome

- **Loop:** `npm run build` (tsc + vite) + visual check of tab
  disablement.
- **Predicted:** when no project is loaded, only Projects tab works;
  Note/Graph/Review tabs and Add Sources / Generate nodes buttons are
  dimmed and ignore clicks.
- **Confirmation:** TS compile clean, vite bundle 178.02 kB; click
  guards wired.

## Multi-model review verdict

Pending — to be folded into Slice 2 review pass.