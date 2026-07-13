# Slice 1 — Project Container + Markdown Note Persistence + Migration

## Why this slice exists

`plan.md` (Approved execution addendum, 2026-06-30) makes Slice 1 the gate
for almost everything downstream: "Core and Tauri command seam
implemented; UI cutover pending". Without Slice 1 shipped, every later
slice (brand, gating, source versions, project-level graph) has no real
Project to operate on.

## Features

| # | Feature | Status |
|---|---|---|
| 01 | Canonical node persistence to `vault/nodes/` | ✅ implemented in commit `601b8b6` (pending UI cutover) |
| 02 | Project-scoped Tauri commands (replace `save_note`/`list_notes`) | ⏳ in progress (this slice) |
| 03 | React UI cutover + idempotent legacy migration | ⏳ in progress (this slice) |

## Cutover gate

> Do not invoke legacy migration automatically until React stops calling
> legacy `save_note`/`list_notes`. Slice 2 must run migration before
> first Project list, switch all Note writes to Project commands, verify
> the migrated Project, then retire the legacy UI path without deleting
> the legacy SQLite table.

## Slice-level trade-offs

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| Filesystem Markdown is canonical (per CONTEXT.md rule) | Good for 10k+ nodes | High — human-auditable | Strong if vault is encrypted | Cheap reads | User trusts the file layout |
| Atomic write + .tmp + .bak swap | Same | One writer won | Safe vs. partial writes | O(file) per write | Invisible to user |
| Idempotent migration with pre-migration SQL backup | Same | Run twice safely | Reversible via restore | One-time O(rows) | "It just shows up" |
| Keep legacy `learning_notes` table on disk after cutover | Same | Costs ~MB | Costs nothing | Costs nothing | Reading from new path is invisible |

## Diagnose loop for this slice

For every feature in this slice, use this same loop:

1. **Build a fast feedback loop:**
   - For Rust modules: `cargo test -p local-knowledge-core`
   - For Tauri commands: integration test harness in `tests/integration/`
   - For React UI cutover: `tsc --noEmit` + manual smoke through
     `tauri dev`.
2. **Reproduce** the legacy behavior gap (legacy `save_note` writes to
   `learning_notes`, project command should write to `projects/<id>/notes/`).
3. **Hypotheses** before instrumenting.
4. **Instrument** the IPC boundary: log every `invoke` call path and the
   resulting command in Rust.
5. **Fix + regression test.** The seam is `crates/tauri_commands/src/lib.rs`
   — write the failing test there before patching.
6. **Cleanup + post-mortem** — confirm no `[DEBUG-...]` logs survive,
   throwaway harnesses removed, hypothesis documented in commit message.

## Multi-model review checklist

For each module, confirm across reviewers:

- [ ] No relative-path traversal out of vault root (`..` blocked,
      absolute paths blocked, drive prefix blocked)
- [ ] Atomic write preserves previous file on failure
- [ ] Frontmatter is parseable + round-trippable
- [ ] Symlink attacks blocked on every write target
- [ ] No plaintext API keys leaked into error messages
- [ ] Migration is idempotent (callable twice, same final state)
- [ ] No regression on existing `cargo test` count
