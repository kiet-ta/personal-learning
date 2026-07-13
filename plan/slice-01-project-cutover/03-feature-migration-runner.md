# Feature 03 — React-side migration runner + project list bootstrap

## Intent

The very first time the desktop app boots, the UI must trigger the
idempotent legacy migration so existing users get an "Imported" Project
containing their old `learning_notes` rows. Once the UI no longer calls
the legacy commands, the migration is allowed to run automatically per
plan.md Slice 1 cutover gate.

## Status

✅ Implemented in commit `f70f6c4`.

## Affected files

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | First `useEffect` calls `migrate_legacy_workspace` then `list_projects`. Captures `migrationStatus` for status display. |

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Migration runs once on every cold start (idempotent) | Same | Cheap to reason about | Safe — Rust is idempotent | O(rows) one-time | "We migrated your old notes into Imported" surface tells the user |
| Failure is swallowed silently | Same | We surface via error banner instead | N/A | N/A | Avoid broken UI when first run has no legacy data |

## Diagnose loop outcome

- **Loop:** local dev with a pre-seeded `.app/index.sqlite` containing
  `learning_notes` rows.
- **Predicted behavior:** open the app once → migrated to Imported Project → opening again reports `alreadyCompleted`.
- **Confirmation:** by construction (Rust tests cover idempotency).

## Multi-model review verdict

Pending — covered together with feature 02.
