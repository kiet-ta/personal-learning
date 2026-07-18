# Slice 4 — Project-level Graph/Review + Filters + Metrics

## Why This Slice Exists

`plan.md` locks:

> Graph + Review default to current Project; Note filter works; metrics derived
> from append-only Learning Events with transparent thresholds.

Slices 1–3 gave us a vault with Projects owning Sources and Notes. Slice 4
makes the Graph and Review workspaces aware of the active Project, wires every
Review submission into an immutable **Review Run** (not a mutable result), and
exposes a **transparent metrics** panel so the user can audit every number.

## Features

| # | Feature | Status |
|---|---|---|
| 08 | `metrics.rs` — `LearningMetrics`, `MetricsThresholds`, `derive_learning_metrics()` | ✅ implemented |
| 09 | Tauri commands — `create_project_review_run`, `list_project_review_runs`, `list_learning_metrics` | ✅ implemented |
| 10 | React UI — project-scoped Graph (SourceVersion nodes), Review workspace (note filter chips, citation chips, runs sidebar, metrics sidebar) | ✅ implemented |
| 11 | Note workspace — project-scoped note filter input with tag display | ✅ implemented |

## Gate

Graph + Review default to current Project; Note filter works; metrics derived
from append-only Learning Events with transparent thresholds.

## Affected Files

| File | Change |
|---|---|
| `crates/core/src/metrics.rs` | NEW — transparent metrics with explicit threshold struct |
| `crates/core/src/review_runs.rs` | Run-id collision fix; `validate_entity_id` guard; real `vault_relative_path` in parse; 4 new regression tests |
| `crates/core/src/project_vault.rs` | `validate_entity_id` made `pub(crate)` for cross-module reuse |
| `crates/core/src/lib.rs` | Module + re-exports for `metrics` |
| `crates/tauri_commands/src/lib.rs` | DTOs + 3 command handlers + round-trip integration test |
| `apps/desktop/src-tauri/src/main.rs` | Registered `create_project_review_run`, `list_project_review_runs`, `list_learning_metrics` |
| `apps/desktop/src/App.tsx` | Types, state, effects, `filteredProjectNotes` memo, `buildRoadmapNodes` wired to project versions, project-scoped Review workspace, Note filter input |

## Trade-off Table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Immutable Review Run Markdown per submit | 10k runs = 10k small files (fine for single-user) | Each run auditable; no mutable state | Run id collision guards prevent overwrites | O(1) per submit; O(n) list reads | User sees run history |
| Metrics derived from JSONL events | JSONL grows linearly; acceptable for personal vault | Every number traces to an event — transparent | No sensitive content in events | O(projects × events) scan for recent counts | Dashboard with explicit thresholds |
| Collision-resistant run ids (counter + timestamp + entropy) | No collisions even in same-millisecond clicks | Run id format `run_<ts>_<counter>_<salt:04x>` | N/A | ~O(1) | Predictable human-readable ids |
| `validate_entity_id` on project_id before filesystem touch | N/A | Consistent with `project_vault.rs` discipline | Prevents traversal injection into Review Run paths | N/A | N/A |

## Diagnose Loop Outcome

- **Loop**: `cargo test --offline -p local_knowledge_core` (83 tests) + `npx tsc --noEmit` (clean) + `npx vite build` (clean).
- **Critical fix 1**: Run-id collision on same-millisecond creates — fixed with `mint_run_id` using process counter + nanosecond entropy.
- **Critical fix 2**: Placeholder `<run>` literal in `vault_relative_path` — fixed to use actual `run_id`.
- **Critical fix 3**: Missing `validate_entity_id` guard — `pub(crate)` exposed from `project_vault.rs`.
- **Warning fix**: Future-dated events counting as "recent" — added `created_at <= now` clock-skew guard.
- **Tests added**: 4 regression tests covering same-ms collisions, unsafe project ids, parse path, and future-dated events.
- **Confirmation**: 83 core + 11 tauri_commands + 0 TS errors + Vite build clean.

## Multi-Model Review Verdict

**VERDICT: pass-with-followups** (all criticals resolved before merge).

| Severity | Finding | Resolution |
|---|---|---|
| Critical | Run-id collision in same ms | Fixed via `mint_run_id` |
| Critical | `<run>` placeholder in path | Fixed: uses actual `run_id` |
| Critical | Missing `validate_entity_id` guard | Fixed: `pub(crate)` exposed |
| Warning | O(projects × events) recent count | Future work: pre-group events |
| Warning | Future-dated events as "recent" | Fixed: clock-skew guard added |

## Open Items (Post-MVP)

1. **O(n²) recent count**: Pre-group events by project_id in `derive_learning_metrics` to eliminate the second scan.
2. **Metrics persistence**: Currently computed on-demand from JSONL; could be cached as a lightweight summary file with rebuild trigger.
3. **Review Run viewer**: No UI to open and inspect an existing run Markdown file (the path is in `vault_relative_path`).
4. **Metrics persistence**: Store `MetricsThresholds` per project in `project.json` so users can tune the "active learner" badge.
