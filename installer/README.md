## RoachNet Setup

Legacy reference only. This Electron setup shell is retained for feature-parity review while the SwiftUI setup app replaces it. It is not used by the native shipping lane.

Purpose:
- preserve old setup flow behavior for audits
- compare installer copy, prerequisite checks, and handoff states against the native setup app
- provide a rollback reference only when native parity has not been proven

Legacy Electron entrypoints:
- `installer/main.cjs`
- `installer/preload.cjs`
- `installer/renderer/`
- `installer/builder.cjs`

Native shipping entrypoints:
- `native/macos/Sources/RoachNetSetup/main.swift`
- `scripts/run-roachnet-setup.mjs`
- `scripts/build-native-macos-apps.mjs`
