# Plan Folder — How to Read and Use

This folder is the implementation log. Every commit tied to a slice or
feature should also update the matching markdown here.

## When you start a session

1. Read `../CONTEXT.md` (project memory).
2. Read `00-master-roadmap.md` (slice status board).
3. Find the slice you're resuming and read its feature files in numeric
   order.

## When you finish a feature

1. Update the feature's markdown file with: status, real diff summary,
   regression test result, multi-model-review verdict.
2. Bump the slice status row in `00-master-roadmap.md`.
3. Only then move to the next feature.

## When a session ends mid-work

Append a "Handoff snapshot" section at the bottom of the in-progress
feature file with:

- Last commit SHA
- Last green `cargo test` / `tsc` output snippet
- Open hypothesis / next probe
- Blockers requiring user input

This preserves enough context that the next session (or another agent)
can resume without reading the chat transcript.

## Markdown file naming convention

| Pattern | Example |
|---|---|
| `slice-NN-slug/01-feature-name.md` | `slice-01-project-cutover/01-feature-canonical-node-persistence.md` |

Numbering is stable. If a feature is split, the new one takes the next
number with a letter suffix (`01a-...`).
