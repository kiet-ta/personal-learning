#!/usr/bin/env bash
# Create a worker worktree branched from a frozen feature branch.
#
# Usage:
#   scripts/setup-worktree.sh <feature-branch> <role> [worktree-root]
#
# Example:
#   scripts/setup-worktree.sh 001-player-combat backend
#   -> branch agent/001-player-combat-backend
#   -> worktree ../learn-alone-worktrees/001-player-combat-backend
set -euo pipefail
cd "$(dirname "$0")/.."

feature_branch="${1:?usage: setup-worktree.sh <feature-branch> <role> [worktree-root]}"
role="${2:?usage: setup-worktree.sh <feature-branch> <role> [worktree-root]}"
worktree_root="${3:-../learn-alone-worktrees}"

if ! git show-ref --verify --quiet "refs/heads/${feature_branch}"; then
  echo "error: branch '${feature_branch}' does not exist locally." >&2
  echo "Create and freeze the feature branch (spec.md/plan.md/tasks.md) first." >&2
  exit 1
fi

worker_branch="agent/${feature_branch}-${role}"
worktree_dir="${worktree_root}/${feature_branch}-${role}"

mkdir -p "${worktree_root}"
git worktree add "${worktree_dir}" -b "${worker_branch}" "${feature_branch}"

echo "Worktree ready: ${worktree_dir}"
echo "Branch:         ${worker_branch}"
echo "Next: cd ${worktree_dir} && claude"
