# Slice 6 — UI/UX Pass: Project Card Actions + Graph Onboarding

**Date**: 2026-07-13
**Scope**: Frontend-only (no backend changes; uses existing `rename_project` command)
**Triggered by**: User feedback that project cards had a dead 3-dot menu and the Graph tab looked empty after creating a new project.

## Problem

Two distinct UX failures in the Projects and Graph workspaces:

1. **Dead affordance on project cards.** The `<button class="project-card-menu">...</button>` rendered three dots but had no `onClick` handler and no menu component. Users had no way to rename, export, or delete a project. This is a classic AI-slop UI tell: a button that promises an action and delivers nothing.

2. **Graph tab empty after project creation.** `buildRoadmapNodes` always merged 5 hard-coded pipeline nodes (`Capture`, `Source index`, `AI draft nodes`, `Approval gate`, `Review prompt`) with project data. A brand-new project with no sources and no drafts therefore showed only the abstract pipeline plus a tiny "Click a node" hint in the corner. The hint did not explain what the user should do next or which workspace to open.

A smaller cleanup was also folded in: the toolbar contained a `+ Create project` button that called the same handler as the dedicated "Create new project" card. Two CTAs with the same intent on one screen, banned by the design rule against duplicate CTA intent.

## Approach

### Project cards

Replaced the dead 3-dot menu with a **hover-reveal action row** anchored to the top-right corner of each card:

- `Rename` (ghost pill button)
- `Open` (primary pill button, uses the existing `blue` accent)

Both are `opacity: 0` by default and fade in on `:hover` or `:focus-within`. The primary `Open` button is also keyboard-focusable via tab through the card. When `Rename` is clicked, the card body is replaced inline by an input + Save / Cancel buttons, so rename never opens a modal or hides the card list behind an overlay.

Clicking the card body itself also opens the project (single-click affordance for the common case). This mirrors how `handleSelectProject` was already used elsewhere.

Why this approach and not a real popover menu:

| Option | Decision |
|---|---|
| Real 3-dot menu with rename + export + delete | Rejected: no `delete_project` backend command exists, and an MVP delete path that wipes immutable review runs would be unsafe. Adding scope creep to ship the menu would violate the project's hard rule about not expanding MVP scope silently. |
| Hover-reveal action row (chosen) | Selected: minimal DOM, no dead affordance, integrates with the card's existing focus model. |
| Remove the menu entirely | Rejected: rename is a real, low-risk action users expect on project lists. Removing it would just move the same friction somewhere else. |

### Graph empty state

Replaced the tiny `graph-empty-hint` (250px wide, bottom-right, "Click a node" copy) with a `graph-empty-panel` that fills the same sidebar slot as `node-sidebar` and contains a **3-step Next Steps list**:

1. **Upload sources** - switches to Note workspace where the file picker lives.
2. **Generate nodes** - calls the existing `handleGenerateGraph` if the active note has body content; disabled otherwise.
3. **Approve relations** - shows a "Waiting for nodes" status pill so step 3 does not look like a broken button.

Each step shows a numbered chip (01 / 02 / 03), a title, and a one-line description. The CTA on each step is context-aware: step 2's button is disabled until the active note has content, and step 3 is intentionally a status badge rather than a button.

The panel only renders when no node is selected. Once the user clicks any node, the standard `node-sidebar` takes over. This keeps the Graph tab useful for exploration (clicking a seed reference node still works) without misleading new users into thinking the pipeline nodes are real project data.

### Seed pipeline nodes

The 5 hard-coded pipeline nodes are now marked `tone: "reference"` and `reference: true`. A new CSS rule dims them to 42% opacity and desaturates them by default. When the user generates real project data (sources or drafts), the canvas root receives `data-has-project-data="true"` and the reference nodes fade further to 28% so the user's own nodes stand out.

This preserves the pipeline as a visual reference but stops it from looking like the only thing the graph contains.

### Duplicate CTA removal

Removed the toolbar `+ Create project` button. The dedicated `Create new project` card at the start of the grid is the single source of intent for "I want a new project."

## Files Changed

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | Added `renamingProjectId` and `renamingProjectTitle` state. Added `handleOpenProject`, `startRenameProject`, `commitRenameProject`, `cancelRenameProject` handlers. Replaced dead 3-dot button with hover-action row. Replaced `graph-empty-hint` div with `graph-empty-panel` Next-Steps aside. Marked seed nodes as `reference`. Removed unused `openProject` helper. Removed duplicate `+ Create project` toolbar button. Added `data-has-project-data` attribute on the roadmap canvas. |
| `apps/desktop/src/styles.css` | Added `.graph-empty-panel`, `.next-steps-list`, `.next-step`, `.next-step-meta`, `.next-step-index`, `.next-step-status` rules. Replaced `.project-card-menu` rules with `.project-card-actions`, `.project-card-action` (with `.primary` variant), `.project-card-rename`, `.project-card-rename-actions` rules. Added `.roadmap-node.reference` rule with dim/saturate and a stronger dim when `[data-has-project-data="true"]`. Hid legacy `.graph-empty-hint` rule (kept selector for backwards compatibility but `display: none`). |

No Rust, Cargo, Tauri command, or schema changes.

## Trade-offs

| Concern | Choice | Why |
|---|---|---|
| Rename UX location | Inline on card | Avoids modal interruption; matches Linear-style project list behavior. |
| Delete UX | Not exposed | No safe MVP path; review runs are immutable. |
| Empty graph copy | Next-Steps panel | Tells the user what to do, not just where to click. |
| Reference node visibility | Dim instead of remove | Preserves pipeline context for new users without hiding real data. |
| Card open affordance | Card body click + hover action | Removes the "where do I click?" confusion the dead 3-dot created. |
| Hover-only actions | Yes | Matches the dense, calm productivity aesthetic the rest of the app uses. Keyboard users still get focus-reveal. |

## Diagnose Outcome

- `npx tsc --noEmit` passed cleanly after edits.
- Vite hot-reload picked up all changes without errors (verified in dev log: 5 page reloads + 3 HMR updates for styles).
- Tauri Rust binary did not need a rebuild because all changes are frontend-only.
- Vite dev server returned HTTP 200 after edits.

## Hard Rule Compliance

- No new MVP scope. Only the already-planned `rename_project` command is wired into the UI.
- Vault durability unchanged. No new filesystem writes or schema changes.
- Local-first posture unchanged. No cloud, sync, or telemetry added.
- No third-party skill code added to runtime.

## Open Items

- No `delete_project` Tauri command exists. If the user wants delete later, it must be designed with explicit confirmation and a clear policy on whether immutable review runs under `projects/<id>/reviews/` are kept, archived, or deleted together.
- The project card hover action row is not yet tested with a keyboard-only user flow beyond `:focus-within`. Manual verification on Windows + macOS Tauri WebView recommended.
- If the project list grows past ~20 projects, the hover-action pattern may collide with adjacent cards on small screens. Not a current concern for MVP.

## Follow-up: Disabled Tabs Were a "Dead Affordance"

User reported that the topbar tabs (Note / Graph / Review / Companion) appeared clickable but did nothing. Root cause: the Slice 2 hard rule keeps these tabs scoped to a Project, so before a Project is selected the buttons receive `disabled={true}`. HTML's `disabled` attribute swallows click events silently, so the user only saw a `title` tooltip on hover and had no clear path forward.

Fix:

- Disabled tabs now render a small second line under the label: `Open a Project to unlock`.
- Clicking a disabled tab is now smart: instead of doing nothing, it switches the workspace to Projects and smooth-scrolls to the projects area, with a status message explaining the redirect.
- A new `active-project-pill` in the topbar always shows the active project title (or `No project` in muted style). This makes the gating condition visible at a glance so the user understands why the other tabs are dimmed.
- Visual: disabled tabs use `.gated` class with reduced opacity, `cursor: not-allowed`, and a subtle hover background that signals "interactive but locked" without inviting a click.

Hard rule `requiresProject` is unchanged. The fix is purely UX: the gate stays, but the user is never left wondering what to do.

### Files added or changed in follow-up

| File | Change |
|---|---|
| `apps/desktop/src/App.tsx` | Topbar tabs now render a `gateHint` second line when disabled. Disabled-click handler switches to Projects and scrolls into view. New `active-project-pill` element added at the start of `topbar-actions`. |
| `apps/desktop/src/styles.css` | New `.page-tabs button.gated` rule (opacity, cursor, hover). New `.page-tab-labels` and `.page-tab-labels small` rules for the second-line hint. New `.active-project-pill` and `.active-project-dot` rules. |