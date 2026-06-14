# Phase 1 Verification

## Implemented Checks

Run the document worker unit tests:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/test-worker.ps1
```

Covered behavior:

- Markdown headings produce separate source-anchored nodes.
- Plain text produces a single `Untitled` node.
- Node and asset IDs are stable for identical content.
- Unsupported extensions are rejected.

## Planned Checks After Toolchain Setup

Run Rust tests:

```powershell
cargo test
```

Run desktop build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/npm-install.ps1
powershell -ExecutionPolicy Bypass -File scripts/dev/desktop-build.ps1
```

Run Flutter analysis:

```powershell
cd apps/mobile_flutter
flutter pub get
flutter analyze
```

## Current Blockers

- Direct npm CLI install/build works through `scripts/dev/*`, but the global
  npm PowerShell shim still points at a broken Roaming profile.
- Tauri `cargo check` is blocked by Windows Application Control policy when
  dependency build scripts execute.
- `flutter pub get`, `flutter doctor`, and `flutter analyze` time out in this
  environment before producing diagnostics.
