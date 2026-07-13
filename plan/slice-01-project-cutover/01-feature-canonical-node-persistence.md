# Feature 01 — Canonical Node Persistence (foundation layer)

## Intent

Approved AI/heuristic draft nodes must be written as durable
`vault/nodes/<node_id>.md` files with YAML frontmatter so the filesystem
vault remains the canonical source of truth (per CONTEXT.md "vault is the
product").

## Status

✅ Implemented in commit `601b8b6` (see `crates/core/src/node_persistence.rs`).

## Affected files

| File | Change |
|---|---|
| `crates/core/src/node_persistence.rs` | `PersistedNode` struct + `persist_node()` write path (atomic via `.tmp` + `.bak`), frontmatter, invariants. |
| `crates/core/src/draft.rs` | Emit shape compatible with `PersistedNode`. |
| `crates/core/src/rag.rs` | Expose source anchor metadata to the persistence layer. |
| `crates/tauri_commands/src/lib.rs` | Call `persist_node` from the LLM draft command. |
| `crates/tauri_commands/Cargo.toml` | Dependency bump. |
| `Cargo.lock` | Lock sync. |

## Trade-off table

| Decision | Scalability | Maintainability | Security | Performance | UX |
|---|---|---|---|---|---|
| YAML frontmatter with custom parser | Good — no YAML lib dep | Smaller surface | Safe | O(1) parse | Parsed by humans without extra tool |
| Atomic write (tmp + .bak) | Same | Single writer per node_id | Survives mid-write crash | Same | User always sees valid file |
| Reject empty title/body at write time | Same | Caller contract clear | N/A | Cheap | Caller gets actionable error |

## Diagnose outcome

- **Loop:** `cargo test -p local-knowledge-core`
- **Repro:** before fix, approved nodes only lived in the LLM response
  payload — never durable.
- **Hypothesis (ranked):**
  1. `persist_node` missing entirely → confirmed (file just created).
  2. Frontmatter round-trip failure → covered by added unit test.
  3. Atomic write race on Windows reserved names → covered by symlink
     follow-up in Slice 1 gate work.

## Multi-model review verdict

Pending — to run when Slice 1 review pass opens.
