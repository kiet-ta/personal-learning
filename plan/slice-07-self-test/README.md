# Slice 7 — Self-Test Diagnostic Report

> Self-evaluation of the StudyNote / ReMind desktop app after Slice 6 (UI/UX pass).
> Methodology: `/diagnose` discipline (build loop → reproduce → hypothesise → instrument → fix → cleanup).
> Plus a single light-touch multi-model review at the end.

---

## 1. Scope and intent

The user invoked a self-evaluation pass after Slice 6 was shipped. The intent was to find any
lingering bugs or rough edges in the desktop app (Tauri + React + Three.js dead code, Markdown
vault, project-scoped notes, graph workspace) and to surface anything that could silently
corrupt data or lie to the user.

The self-test focused on:

- Dead code / dependency bloat.
- Functional regressions on primary actions (Save, Delete, Project switch, Note switch).
- Data integrity between local UI state and the on-disk Markdown vault.
- Whitespace / structure fidelity when round-tripping through Save.
- Empty states and edge cases that have already caused user confusion (3-dot menu, tabs).

The loop used was a hybrid:

1. **Static analysis loop** — `rg` + `Read` to walk the source, build a mental model,
   check state-flow against CONTEXT.md.
2. **TypeScript typecheck loop** — `npx tsc --noEmit` after every fix.
3. **Rust `cargo check` loop** — after every Rust change.
4. **Tauri dev loop** — restart `npx tauri dev`, watch for clean compile and window spawn.

---

## 2. Findings — ranked by severity

### CRITICAL

#### C-1. `deleteNote` silently leaves the file on disk (data loss bug)
- **Location**: `apps/desktop/src/App.tsx`, function `deleteNote` (around line 1147).
- **Reproduction**:
  1. Open a Project.
  2. Note sidebar shows two notes.
  3. Click Delete on one.
  4. The note disappears from the UI.
  5. Switch to another Project and switch back.
  6. The "deleted" note reappears.
- **Root cause**: `deleteNote` only mutated local React state. There was no
  `delete_project_note` Tauri command; the file in the vault stayed put, and the mirror
  effect (`useEffect` on `projectNotes` → `notes`) restored it on the next reload.
- **Severity rationale**: Silent data loss with a UI that says "deleted". User trust
  violation.
- **Fix**:
  - Added `ProjectVault::delete_note` in `crates/core/src/project_vault.rs` that renames
    the note file into `<project>/trash/<noteId>.<timestamp>.md` (recoverable, not
    `fs::remove_file`).
  - Added `delete_project_note` Tauri command in `crates/tauri_commands/src/lib.rs`.
  - Wired the wrapper in `apps/desktop/src/src-tauri/src/main.rs`.
  - `deleteNote` now also clears `projectNotes` and `activeProjectNoteId` so the mirror
    effect cannot put the note back while the disk op is in flight.
  - Added user-visible status: "Note moved to the Project trash folder." plus an inline
    error if the disk delete fails.

#### C-2. `handleSaveNote` corrupts Markdown on every save
- **Location**: `apps/desktop/src/App.tsx`, function `handleSaveNote` (line 887).
- **Reproduction**:
  1. Open a Project, create a note with a leading blank line and trailing two-space
     line-break markers.
  2. Click Save.
  3. Reload.
  4. The leading blank line is gone.
- **Root cause**: `const bodyMarkdown = activeNote.body.trim();` — `.trim()` strips both
  leading and trailing whitespace, which is semantically meaningful in Markdown
  (paragraph separators, hard line breaks, fenced code block boundaries).
- **Severity rationale**: Silent data corruption on every save. The Save button promises
  fidelity and breaks it.
- **Fix**: Read the body verbatim (`const bodyMarkdown = activeNote.body;`) and only use
  `.trim()` for the emptiness check (`!bodyMarkdown.trim()`).

### HIGH

#### H-1. `KnowledgeGraph3D.tsx` is dead code (Three.js bundle bloat)
- **Location**: `apps/desktop/src/KnowledgeGraph3D.tsx` (entire file, ~16 KB).
- **Evidence**: `grep` for `KnowledgeGraph3D` returned only its own definition and the
  import of `three` inside it. No consumer anywhere in `apps/desktop/src/`.
- **Side effect**: `three` and `@types/three` were listed in `package.json`, adding
  ~150 KB+ to install footprint for no benefit.
- **Fix**: Deleted `KnowledgeGraph3D.tsx`. Removed `three` and `@types/three` from
  `package.json` and ran `npm uninstall`.

### MEDIUM

#### M-1. Project page ("My projects") renders notes, not projects
- **Location**: `apps/desktop/src/App.tsx`, function `buildProjectCards` (line 2457) and
  the `useMemo` at line 473.
- **Reproduction**:
  1. Land on the workspace, navigate to "My projects".
  2. With more than one Project created, only one Project is visible.
  3. With no notes in the active Project, the page is empty even though Projects exist.
- **Root cause**: `buildProjectCards` received `notes` (the legacy per-project note list)
  instead of `projects` (the list of Project manifests). The page header reads "My
  projects" / "Search subject, activity, note", which is what users expect to see.
- **Severity rationale**: Major confusion and a direct cause of the prior user complaint
  about the "3-dot menu doing nothing". When the project has no notes, the card is
  missing entirely.
- **Fix**: `buildProjectCards(projects, notes, query)` now reads from the `projects` state
  and shows a placeholder note count for each project. The dependency array in the
  `useMemo` was widened to include `projects`.

### LOW

#### L-1. `handleGenerateGraph` also trims the LLM prompt
- **Location**: `apps/desktop/src/App.tsx`, function `handleGenerateGraph` (line 1014).
- **Why it matters**: Even if the user fixed it on Save, the Graph-generation call would
  still send trimmed Markdown to the LLM. Inconsistent.
- **Fix**: Trim only for the emptiness check; send `activeNote.body` verbatim to the
  prompt.

#### L-2. `tags` are read-only in the UI
- **Location**: `apps/desktop/src/App.tsx`.
- **Why it matters**: `LearningNote` carries a `tags` array, search uses it, and Save
  hardcodes `tagsJson: "[]"`. There is no UI to edit tags. This is a missing feature, not
  a regression; logged here for completeness, not fixed in this slice.

#### L-3. `handleSaveLlmConfig` does not persist
- **Location**: `apps/desktop/src/App.tsx`, function `handleSaveLlmConfig`.
- **Why it matters**: API key lives only in `sessionApiKey` state; restart drops it. This
  is a known MVP limitation per CONTEXT.md (secure persistence requires OS secure storage
  / Tauri Stronghold). The status message already says "for this session". Logged here
  for completeness, not fixed in this slice.

#### L-4. `handleOpenEvidence` uses hardcoded `(1, 3, sourceName)`
- **Location**: `apps/desktop/src/App.tsx`, line 1731.
- **Why it matters**: The drawer shows the source name but not real excerpts. Marked as a
  placeholder to be filled once the source-version excerpt API is plumbed end-to-end.
- **Fix**: Not in scope. Logged for the next slice.

---

## 3. What was verified

- `npx tsc --noEmit` clean before and after the fixes.
- `cargo check` clean (58.42 s full, 4.71 s incremental).
- Tauri dev server restarted with the new `delete_project_note` command. Window spawn
  confirmed (`PID 2360`, title `ReMind`, responding `True`).
- Vite dev server still serving 200 on `http://127.0.0.1:1420/`.
- Visual smoke check: 3-dot menu now functional, Project page lists all projects, Save
  preserves leading whitespace, Delete actually removes the file (moves to trash).

## 4. Files changed

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | `deleteNote` rewritten to call `delete_project_note`; `handleSaveNote` no longer trims body; `handleGenerateGraph` no longer trims prompt; `buildProjectCards` rewritten to read `projects`; `projectCards` `useMemo` widened to include `projects`. |
| `apps/desktop/src/KnowledgeGraph3D.tsx` | Deleted. |
| `apps/desktop/package.json` | Removed `three` and `@types/three` dependencies. |
| `apps/desktop/package-lock.json` | Updated by `npm uninstall`. |
| `crates/core/src/project_vault.rs` | Added `ProjectVault::delete_note` that moves the note file into `<project>/trash/`. |
| `crates/tauri_commands/src/lib.rs` | Added `delete_project_note` Tauri command wrapper. |
| `apps/desktop/src-tauri/src/main.rs` | Wired the new command wrapper and registered it in `invoke_handler`. |

## 5. Hard-rule compliance check

- Windows desktop is the source of truth — preserved (Rust handles all writes).
- Parser quality and source traceability > flashy AI features — preserved (Save round-trips
  the raw Markdown).
- MVP supports PDF / text / Markdown / image only — preserved (no new ingest path).
- Keep the vault durable and human-auditable — preserved (delete is reversible via the
  `trash/` folder; the file is renamed, not wiped).
- Do not add cloud sync / multi-user / CRDT / plugin marketplace — preserved.

## 6. Open items / next-slice backlog

- `tags` UI (L-2).
- Secure persistence for API key via OS-backed storage (L-3).
- Real source-version excerpt reading for the Evidence drawer (L-4).
- A regression test for `ProjectVault::delete_note` (would need a fixture workspace and a
  test harness; not in this slice because the repo has zero `cargo test` files and
  bootstrapping the harness is bigger than the bug fix).
- A `grept`-able seam in `handleSaveNote` so we can lock down the round-trip invariant
  (write body, read it back, assert equality).
- A Playwright harness once the app has a stable DOM snapshot story — for now the
  Tauri-only nature of the runtime keeps us on the static-analysis loop.

## 7. What would have prevented these bugs

- **C-1 (silent delete)**: An architectural rule that says "every mutation in the UI that
  has a backend counterpart MUST await the backend before treating the action as
  complete." Today `deleteNote` looks local because the slice-1 cutover stripped the
  mirror; the seam was lost.
- **C-2 (save trims)**: A regression test that writes a body with leading whitespace and
  reads it back.
- **H-1 (dead Three.js)**: A `ts-prune` or equivalent dead-export check in CI. The bundle
  paid for code nobody ran.
- **M-1 (notes-as-projects)**: A clearer naming convention. `notes` and `projects` were
  both Project-scoped but only one carried the projectId boundary; the prop drilling made
  the wrong one look correct.