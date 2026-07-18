#!/usr/bin/env bash
# Baseline verification for this repo. Extend per-feature verification
# commands come from specs/<feature>/execution/manifest.yaml — this script
# is the whole-repo sanity check an integrator runs before/after merging a
# wave.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== cargo test (workspace: crates/core, crates/tauri_commands) =="
cargo test --workspace

echo "== desktop typecheck + build =="
npm --workspace apps/desktop run build

echo "All checks passed."
