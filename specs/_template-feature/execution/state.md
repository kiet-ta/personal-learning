# Execution State — _template-feature

Only the Dispatcher/Integrator edits this file. Workers write their own
handoff under `handoffs/<role>.md` instead, so parallel branches never
conflict on this one.

## Wave 1

| Task IDs | Worker | Branch | Status | Reviewer verdict | Merged commit |
| --- | --- | --- | --- | --- | --- |
| T010, T011 | core | agent/_template-feature-core | not-started | — | — |
| T012, T013 | desktop | agent/_template-feature-desktop | not-started | — | — |
| T014 | tests | agent/_template-feature-tests | not-started | — | — |

Status values: `not-started`, `in-progress`, `handed-off`, `in-review`,
`pass`, `fail`, `merged`, `blocked`.

## Wave 2

Do not create wave 2 worktrees until every wave 1 task is `merged`.

## Blockers

None.
