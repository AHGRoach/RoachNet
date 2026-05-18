## RoachNet Electron Desktop

Legacy reference only. This Electron desktop shell is retained for feature-parity review while the SwiftUI macOS app owns the Apple Silicon release path. It is not used by the native shipping lane.

Native shipping entrypoints:
- `native/macos/Sources/RoachNetApp/main.swift`
- `scripts/run-roachnet-native-api.mjs`
- `scripts/build-native-macos-apps.mjs`

Do not add root package scripts, release gates, or installer payload steps that boot this directory unless native parity is deliberately rolled back.
