# Feature 04 — Apply StudyNote brand in topbar

## Intent

Replace the legacy `ReMind` brand in `App.tsx` topbar with the locked
StudyNote product name. This is purely a UI copy change with no
behavioral effect.

## Status

✅ Implemented in commit pending.

## Affected files

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | Topbar brand string `ReMind` -> `StudyNote`. |

## Diagnose loop outcome

- **Loop:** `npm run build` (tsc + vite).
- **Confirmation:** clean.