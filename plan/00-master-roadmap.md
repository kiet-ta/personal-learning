# Master Roadmap — StudyNote 5-Slice Implementation

This folder tracks every implementation milestone across the 5 slices defined
in `../plan.md` (Approved execution addendum, 2026-06-30). Each slice is a
self-contained checkpoint with its own subfolder and per-feature markdown
files. Use this folder to recover context after a session break.

## Slice Status Board

| Slice | Owner | Status | Subfolder | Gate |
|---|---|---|---|---|
| 1. Project + Markdown Note persistence + migration | BE-1 | ✅ done | `slice-01-project-cutover/` | React stops calling legacy `save_note`/`list_notes`; migration runs idempotently; legacy UI path retired. |
| 2. StudyNote brand + project gating + Note→Review→Graph | FE-1 + FE-2 | ✅ done | `slice-02-brand-gating/` | Brand applied; non-Project state disables Note/Review/Graph/Add Sources/Generate Nodes. |
| 3. Project-owned Source Versions + Evidence detail drawer | BE-1 + FE-1 | ✅ done | `slice-03-source-evidence/` | Each Project owns Sources; imports create new immutable SourceVersion; Evidence drawer renders typed locators. |
| 4. Project-level Graph/Review + filters + metrics | BE-1 + FE-1 | ✅ done | `slice-04-graph-review-metrics/` | Graph + Review default to current Project; Note filter works; metrics derived from append-only Learning Events with transparent thresholds. |
| 5. PET MVP (deterministic state + action cards + paid AI) | BE-2 + FE-1 | ✅ done | `slice-05-pet-companion/` | One vault-level companion, Project-aware, never mutates canonical data autonomously, paid AI only on explicit user action. |
| 6. UI/UX pass (project card actions + graph onboarding) | FE-1 | ✅ done | `slice-06-ui-ux-pass/` | Dead 3-dot menu replaced with hover-action row; Graph empty state explains next steps; seed pipeline nodes marked as visual reference. |
| 7. Self-test diagnostic + critical bug fixes | FE-1 + BE-1 | ✅ done | `slice-07-self-test/` | Four confirmed bugs fixed (silent delete, save trim corruption, dead Three.js, project-page-wrong-source); regression-tested via `tsc` + `cargo check` + Tauri dev relaunch. |

## Per-Slice Document Layout

```
plan/
├── 00-master-roadmap.md (this file)
├── README.md                    # How to read/use this folder
├── slice-01-project-cutover/
│   ├── 01-feature-*.md          # Per-feature deep-dive
│   ├── 02-feature-*.md
│   └── 03-feature-*.md
├── slice-02-brand-gating/
├── slice-03-source-evidence/
├── slice-04-graph-review-metrics/
└── slice-05-pet-companion/
```

Each feature file follows the same template so cross-slice reading is
predictable:

1. **Intent** — what we're building, one paragraph
2. **Affected files** — paths and modules that must change
3. **Trade-off table** — scalability / maintainability / security / perf / UX
4. **Implementation outline** — concrete steps with code shape
5. **Diagnose loop** — feedback loop, repro, hypothesis probes, fix + regression test, cleanup
6. **Multi-model review checklist** — items to confirm across reviewers

## Execution Discipline Rules

1. **One feature at a time.** Finish, diagnose, multi-model-review, then
   write the markdown file before moving on.
2. **Diagnose loop before writing tests.** Build a fast, deterministic
   pass/fail signal first.
3. **Multi-model review per module.** Each affected Rust module or React
   screen gets an independent review pass.
4. **Hard rule: per `AGENTS.md`**, the markdown here describes **what and
   why**, not narrative exploration logs.

## Cross-Slice Constraints (locked per `plan.md`)

- Windows desktop is the source of truth.
- Flutter mobile companion only (capture / review / lightweight search).
- MVP media scope: PDF / text / image only.
- FTS search must work before semantic search.
- Parser quality + source traceability > flashy AI features.
- Do NOT add: cloud sync, multi-user collab, full CRDT, plugin marketplace,
  audio/video.
- Do NOT make OpenClaw / third-party community skills part of the trusted
  core runtime.
- Vault = filesystem Markdown canonical; SQLite = rebuildable index.
- C1 (API key multi-place) is **deferred** — see `../CONTEXT.md` Known Gaps.
- PET/OpenClaw are future companion/agent layers, never canonical-data
  owners.
