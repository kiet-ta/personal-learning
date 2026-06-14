# Phase 1 Handoff

Date: 2026-06-14

## Goal and Status

Implemented the first code slice for the desktop-first local knowledge app:

- Text/Markdown document worker baseline.
- Rust domain/vault skeleton.
- Thin Tauri command adapter.
- Desktop React/Tauri shell skeleton.
- Flutter companion shell skeleton.
- Schema/API/test documentation for the vertical slice.

## Changed Subsystems

| Subsystem | Files |
|---|---|
| Worker | `workers/document_worker/src/document_worker/*`, `workers/document_worker/tests/test_parser.py`, `workers/document_worker/pyproject.toml` |
| Rust core | `Cargo.toml`, `crates/core/src/*`, `crates/tauri_commands/src/lib.rs` |
| Desktop | `apps/desktop/package.json`, `apps/desktop/src/*`, `apps/desktop/src-tauri/*` |
| Mobile | `apps/mobile_flutter/pubspec.yaml`, `apps/mobile_flutter/lib/main.dart` |
| Dev scripts | `scripts/dev/test-worker.ps1`, `scripts/dev/parse-document.ps1` |
| Docs | `README.md`, `CONTEXT.md`, `docs/schema/0001-core-entities.md`, `docs/api-contract/document-worker.md`, `docs/test-plan/phase-1-verification.md` |

## Key Decisions

- Worker supports `.txt`, `.md`, and `.markdown` first. PDF/OCR remain behind the same output contract.
- Worker emits `source_asset`, source-anchored `nodes`, and `conversion_tool`.
- Rust core currently avoids external dependencies so the domain/vault boundary remains simple until Cargo is available.
- Tauri config now has a restrictive baseline CSP instead of `csp: null`.
- Mobile skeleton uses only Flutter SDK dependencies to avoid early network package resolution.

## Verification

Passed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/test-worker.ps1
```

Result: 4 unit tests passed.

Passed:

```powershell
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); JSON.parse(require('fs').readFileSync('apps/desktop/package.json','utf8')); JSON.parse(require('fs').readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')); console.log('json ok')"
```

Result: package/config JSON parsed successfully.

Passed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/parse-document.ps1 -Path README.md -Pretty
```

Result: README parsed into source-anchored Markdown nodes.

Passed:

```powershell
cargo test
```

Result: Rust core and command adapter tests passed.

Passed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/npm-install.ps1
powershell -ExecutionPolicy Bypass -File scripts/dev/desktop-build.ps1
```

Result: npm dependencies installed, Vite upgraded to `8.0.16`, desktop web
build passed, and `npm audit --audit-level=moderate` found 0 vulnerabilities.

Started:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/desktop-dev.ps1
```

Result: Vite served the desktop shell at `http://127.0.0.1:1420/` and returned
HTTP 200.

## Security and Privacy Review

No secrets, tokens, PII, or connection strings were added.

Security fix applied:

- Replaced Tauri `csp: null` with a restrictive baseline CSP.

Residual security gaps:

- Worker CLI can parse arbitrary paths when run manually. Vault integration must constrain file access to inbox assets.
- Real encryption/SQLCipher integration is not implemented yet.
- Sync pairing/token handling is documented but not implemented.

## Known Blockers

- The global npm PowerShell shim still points at a broken Roaming npm path. Use
  `scripts/dev/npm-install.ps1`, `scripts/dev/desktop-build.ps1`, and
  `scripts/dev/desktop-dev.ps1`.
- Tauri dependency compilation is blocked by Windows Application Control policy
  when Cargo executes dependency build scripts. This affects `cargo check` in
  `apps/desktop/src-tauri`.
- `flutter pub get`, `flutter doctor`, and `flutter analyze` time out before
  producing diagnostics.

## Next Actions

1. Fix Windows Application Control or Cargo build-script execution policy for
   Tauri dependency checks.
2. Repair the global npm shim or keep using `scripts/dev/*`.
3. Diagnose Flutter CLI timeout outside this repo if needed.
4. Implement vault import command: copy allowed source files into inbox, compute
   SHA-256, call worker, persist source-anchored nodes.
5. Add SQLite migration for `source_asset`, `node`, and `node_version`.
