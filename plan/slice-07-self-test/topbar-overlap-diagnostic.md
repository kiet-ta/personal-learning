# Topbar Tab Overlap — Visual Diagnostic Report

> Slice 7 follow-up. The user reported tabs in the topbar visually overlapping after Slice 6
> added the "Open a Project to unlock" gate hint. This report walks the evidence collected,
> the root cause, the fix, and before/after captures.

---

## 1. Symptom (as reported)

The five topbar tabs — Projects (active), Note, Graph, Review, Companion — render in a
single horizontal row, but the gated tabs (Note / Graph / Review / Companion) display
their gate hint ("Open a Project to unlock") overlapping horizontally into the
neighbouring tab. The labels and badge letters appear smeared.

User screenshot: stored at
`C:\Users\kietta\.cursor\projects\d-openclaw-learn-alone/assets/c__Users_kietta_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-ff905cbb-d22b-4bef-aab5-5ae3c40eb3c9.png`.

## 2. Feedback loop used

- Built a headless capture harness at
  `apps/desktop/scripts/capture-tabs.cjs` that drives the running Vite dev server with
  Playwright Chromium and:
  - waits for `.page-tabs` to mount
  - screenshots the entire topbar (`.topbar`)
  - dumps per-button geometry + computed styles + label / small box geometry to
    `probe.json`
- Took two snapshots under the same viewport (1280×800) with only the CSS selector
  between them changed, so the diff is isolated to the fix.

## 3. Evidence captured

| File | Purpose |
|---|---|
| `captures/topbar-before-broken.png` | Screenshot of the broken state (Slice 6 selector). |
| `captures/probe-before-broken.json` | DOM probe of every `.page-tabs button` in the broken state. |
| `captures/topbar-after.png` | Screenshot after the fix. |
| `captures/probe-after.json` | DOM probe after the fix. |

### 3.1 Per-button geometry — broken state

From `probe-before-broken.json`, every tab had:

| Tab | Button rect | `.page-tab-labels` box | `.small` box (when gated) |
|---|---|---|---|
| Projects (active, ungated) | 320, 14.5, 70×32 | **18×18** | (none) |
| Note (gated) | 398, 14.5, 70×32 | **18×18** | 414, 29.7, **63.7×10.5** |
| Graph (gated) | 476, 14.5, 70×32 | **18×18** | 492, 29.7, 63.7×10.5 |
| Review (gated) | 554, 14.5, 70×32 | **18×18** | 570, 29.7, 63.7×10.5 |
| Companion (gated) | 632, 14.5, 70×32 | **18×18** | 648, 29.7, 63.7×10.5 |

The `.page-tab-labels` box is **18 px wide**, identical to the badge box. The `.small`
hint inside it occupies **63.7 px wide** and starts at x=414 — i.e. it overflows the
18 px parent by 45 px and lands directly on top of the next button's badge letter.

### 3.2 Per-button geometry — fixed state

From `probe-after.json`:

| Tab | Button rect | `.page-tab-labels` box | `.small` box (when gated) |
|---|---|---|---|
| Projects (active, ungated) | 320, 14.5, **94.75×32** | 42.75×16 | (none) |
| Note (gated) | 422.75, **9.22**, **97.7×42.6** | 56.5×36.4 | inside labels |
| Graph (gated) | ~528, 9.22, ~104×42.6 | inside button | inside labels |
| Review (gated) | ~640, 9.22, ~104×42.6 | inside button | inside labels |
| Companion (gated) | ~752, 9.22, ~117×42.6 | inside button | inside labels |

All buttons now have **distinct widths** matching their content; labels sit at the
correct x; nothing overflows past the button's right edge.

## 4. Root cause

The selector in `apps/desktop/src/styles.css` was too broad:

```css
.page-tabs button span {
  display: inline-grid;
  width: 18px;
  height: 18px;
  /* ...badge styles... */
}
```

The intent was to style the small letter badge (P / N / G / R / C). The intent was not
documented in a comment, so future readers could not see it was meant to be a badge
only. Because the selector matched **every** `<span>` inside the tab button — including
the sibling `.page-tab-labels` grid — the labels container was clamped to 18×18.

`.page-tab-labels` has `display: grid` and stacks a `<strong>` and an optional `<small>`.
With `overflow: visible` (the default), the actual text rendered outside the 18 px box,
producing the horizontal overlap captured in the screenshot.

A previous Slice 7 fix widened the parent flex container, added `min-width: 0` to the
labels, and shortened the hint text — all sound mitigations, but none of them touched
the actual culprit selector, so the labels box was still 18 px wide.

## 5. Fix

`apps/desktop/src/styles.css`:

```diff
- .page-tabs button span {
+ .page-tabs button > span:first-child {
    display: inline-grid;
    width: 18px;
    height: 18px;
    place-items: center;
    color: var(--blue);
    font-size: 0.7rem;
    font-weight: 900;
    background: #ffffff;
    border: 1px solid var(--line);
    border-radius: 5px;
+   flex: 0 0 auto;
  }
```

- `> span:first-child` selects only the **first** direct child span (the badge) and
  leaves `.page-tab-labels` alone.
- `flex: 0 0 auto` keeps the badge from shrinking when the parent flex container
  compresses; it stays a fixed 18×18 px regardless of how tight the topbar is.

The previous Slice 7 mitigations remain in place:

- `min-width: 0` + `flex: 0 1 auto` on the button itself.
- `min-width: 0` + `max-width: 100%` + `overflow: hidden` + `text-overflow: ellipsis`
  on the labels grid and its children, so the long hint truncates instead of overflowing
  past the button's right edge.
- The hint text was shortened to `"Open Project"` for in-tab rendering while the full
  sentence remains in the `title` attribute and the status toast.

## 6. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Vite HMR reload of `styles.css` | confirmed in `.tauri-dev.log` |
| Tauri window PID 2360 | alive, `Responding: True` |
| `topbar-after.png` vs `topbar-before-broken.png` | 5 tabs render correctly, uniform heights, no overlap |
| `probe-after.json` button rects | distinct widths matching content, `.small` inside button bounds |

## 7. Lesson

A "looks like badge styles" CSS selector was actually selecting every descendant span,
including a sibling grid container that happened to live next to the badge. The fix is
the minimal selector change (`> span:first-child`). The lesson for the repo:

- When writing low-specificity selectors like `.page-tabs button span`, **add a comment**
  explaining what it targets. A future hand-edit will not know it is meant for the
  badge only.
- A regression test would have caught this. The repo has no visual-regression harness.
  Worth scheduling a Playwright snapshot test that runs against the topbar at the next
  slice.