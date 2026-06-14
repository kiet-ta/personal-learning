# Issue Tracker Convention

This repo currently uses local markdown issues for triage. The source code has a
GitHub remote, but issue workflow has not yet been moved to GitHub Issues.

## Location

Write issues under:

```txt
.scratch/issues/
```

Recommended filename:

```txt
YYYYMMDD-short-title.md
```

## Issue Template

```markdown
# Short issue title

## Problem

## Context

## Acceptance Criteria

## Implementation Notes

## Test Notes

## Status

- Triage: needs-triage
- Owner:
- Created:
```

## Agent Rules

- `to-issues` writes independently grabbable vertical slices.
- `triage` updates the `Status` section and uses labels from
  `docs/agents/triage-labels.md`.
- Do not create GitHub or GitLab issues until a remote and workflow are
  explicitly configured.
