# Loop Engineering: Spec Kit + Worktree Multi-Agent Workflow

This is an opt-in workflow for large, well-specified features that benefit from
parallel implementation across multiple isolated Claude Code sessions. It is
**not** the default way to work in this repo — use it only when a feature is
big enough to split into independent workstreams (e.g. backend + frontend +
tests) with a stable, frozen spec.

Do not run this from Cowork. Cowork's sandbox mounts this repo through a
bridge that cannot delete newly created files, which breaks every git write
operation (`commit`, `checkout`, `branch`, `merge`, `worktree add` all fail
because git cannot remove its own `.git/index.lock` after writing it). Run
every step below from a real local terminal on your machine.

## Model

```text
Spec Kit        = source of truth (spec.md / plan.md / tasks.md)
This harness    = operating rules, execution manifest, state, verification
Git worktree    = code isolation between agents
Claude Code     = executes each role in its own terminal
```

Do not open multiple Claude Code terminals in the same working directory.
Each parallel worker gets its own branch + `git worktree`.

## Roles

| Terminal | Role | Edits code? |
| --- | --- | --- |
| 0 | Spec Owner | No, once spec is frozen |
| 1 | Dispatcher + Integrator | Only state, task list, and merges |
| 2+ | Worker (backend/frontend/tests) | Yes, in its own worktree |
| N | Independent Reviewer | No — reviews only, never fixes |

Start with 3 workers, 1 reviewer, 1 integrator, 1 spec owner. Do not scale to
six parallel workers until task ownership and verification are proven stable.

## 1. Install Spec Kit CLI (once, on your machine)

Spec Kit requires Python 3.11+ and Git, and recommends `uv`:

```bash
uv tool install specify-cli
specify version
specify check
```

## 2. Checkpoint before installing anything into this repo

```bash
git status
git switch -c chore/spec-kit-bootstrap
git add -A
git commit -m "chore: checkpoint before spec-kit setup"
```

Never run this with `--force` while there are changes you have not reviewed.

## 3. Initialize Spec Kit in this repo

```bash
specify init --here --integration claude
specify extension add git
git status
git diff
git add .specify
git commit -m "chore: initialize spec-kit for Claude Code"
```

This repo already has `AGENTS.md` as its agent operating guide — do not let
Spec Kit's Claude integration create a competing `CLAUDE.md`. If it does,
fold anything useful into `AGENTS.md` and remove the duplicate so there is
one source of truth.

## 4. Write and freeze the spec (Terminal 0)

```text
/speckit-constitution
/speckit-specify <feature, focused on WHAT and WHY>
/speckit-clarify
/speckit-plan <tech stack, architecture, constraints>
/speckit-tasks
/speckit-analyze
```

Once `specs/<feature>/{spec.md,plan.md,tasks.md}` look right:

```bash
git add specs .specify
git commit -m "spec: freeze implementation plan and tasks"
```

From this point, workers must not edit `spec.md`, `plan.md`, `tasks.md`, or
`constitution.md`. If implementation reveals the spec is wrong, the worker
writes a handoff for the Spec Owner instead of changing the requirement
itself.

## 5. Turn tasks into an execution manifest

Copy `specs/_template-feature/execution/` into `specs/<feature>/execution/`
and fill in `manifest.yaml`. Each task needs: worker, task IDs, branch,
`allowed_paths`, `forbidden_paths`, and the verification commands that must
actually pass (see `scripts/verify.sh` for this repo's real commands).
`allowed_paths` matters more than the worker's name — two workers touching
`package.json`, `Cargo.toml`, or a shared interface can still conflict even
with different role names.

## 6. Create one worktree per worker

```bash
mkdir -p ../learn-alone-worktrees
git worktree add ../learn-alone-worktrees/<feature>-backend  -b agent/<feature>-backend  <feature-branch>
git worktree add ../learn-alone-worktrees/<feature>-frontend -b agent/<feature>-frontend <feature-branch>
git worktree add ../learn-alone-worktrees/<feature>-tests    -b agent/<feature>-tests    <feature-branch>
git worktree add ../learn-alone-worktrees/<feature>-review   -b review/<feature>         <feature-branch>
git worktree list
```

Create worktrees from the frozen feature branch, not `main` — `claude
--worktree` defaults to branching off the repo's default branch, which is
usually wrong here.

Do not copy `.env` or secrets into every worktree by default.

## 7. Run each worker

Each worker terminal:

```bash
cd ../learn-alone-worktrees/<feature>-<role>
claude
```

First prompt should tell the worker: read `AGENTS.md`, the frozen spec/plan/
tasks, and its `manifest.yaml` entry before touching anything; only modify
its `allowed_paths`; never touch spec/plan/tasks or secrets; run every
assigned verification command for real; commit with task IDs; write a
handoff under `specs/<feature>/execution/handoffs/<role>.md`.

The reviewer never fixes code. It returns PASS/FAIL with evidence, checked
against the branch diff, not the worker's own summary.

## 8. State and integration

Only the Dispatcher/Integrator updates `tasks.md` and
`specs/<feature>/execution/state.md`. Workers only write their own handoff
file, so parallel branches never conflict on the same file.

```bash
git diff <feature-branch>...agent/<feature>-backend
```

If PASS, integrator cherry-picks or merges, then runs `scripts/verify.sh`.
Only create the next wave's worktrees after the current wave is merged back
into the feature branch — later workers need integrated code, not a stale
base.

## 9. Finish

```text
/speckit-converge
```

Then `scripts/verify.sh`, review the final diff against `main`, open a PR,
and clean up:

```bash
git worktree remove ../learn-alone-worktrees/<feature>-backend
git worktree remove ../learn-alone-worktrees/<feature>-frontend
git worktree remove ../learn-alone-worktrees/<feature>-tests
git worktree remove ../learn-alone-worktrees/<feature>-review
git worktree prune
```

## Rules

- Never run six agents in one working directory — worktrees exist to prevent
  file collisions between them.
- Workers never edit `tasks.md` — every branch ticking the same checkbox is a
  guaranteed conflict.
- The reviewer never edits worker code — maker and checker stay separate.
- A task is not done until its verification command actually exited 0. Do
  not report a command as passing without having run it.
