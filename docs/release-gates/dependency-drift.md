# Dependency Drift Gate

This gate is repo-grounded only. Current and locked versions must come from `package.json`, `package-lock.json`, `admin/package.json`, and `admin/package-lock.json`; do not fill target versions from memory or package-registry guesses.

## Native Shipping Scope

- Root package version: `1.0.5`
- Root entrypoint: `scripts/run-roachnet-native-api.mjs`
- Root local engine: Node `>=26 <27`, npm `>=10`
- Local default Node: `.nvmrc` pins `26`; bundled runtime freshness is tracked separately in `runtime-freshness.json`
- CI Node runtime: native/root setup-node workflows must pin Node `26` or read `.nvmrc`; the quarantined admin PR workflow must pin Node `24` until `@openzim/libzim` supports current Node majors.
- Root runtime dependencies: none
- Root dev dependencies:
  - `convex` declared `^1.39.1`, locked `1.39.1`
  - `typescript` declared `^6.0.3`, locked `6.0.3`

The public native desktop lane must stay runnable through the first-party SwiftUI app, setup app, and dependency-free native API bridge. It must not require Electron, the legacy WebUI runtime, `npm --prefix admin ci`, or staged admin `node_modules`.

## Legacy Admin Scope

- Admin package version: `0.0.0`
- Admin package is private.
- Admin local engine: Node `>=24 <25`, npm `>=10`
- Admin exception: `@openzim/libzim` still declares `<25`, so the legacy admin/WebUI lane remains Node 24-only until the ZIM reader is replaced by the native Vault path or the upstream package supports current Node.
- Admin top-level dependencies: `56`
- Admin top-level dev dependencies: `22`

The admin/WebUI tree remains reference and feature-parity material while native replacements land. It is not a public native runtime requirement. Top-level admin-only helper dependencies that are no longer needed by the current manifest must stay out of `admin/package.json`; transitive lockfile entries can remain only when required by declared packages.

For local admin maintenance on machines that default to Node 26, run `npm run admin:doctor`. If Node 24 is missing, install it with Homebrew and point the admin build at that binary:

```sh
brew install node@24
ROACHNET_ADMIN_NODE_BINARY="/opt/homebrew/opt/node@24/bin/node" node scripts/build-admin-runtime.mjs
```

This is a maintainer-only legacy lane. Native RoachNet users and release installers must not need Node 24.

## Legacy Electron Quarantine

The `desktop/` and `installer/` Electron trees are retained as feature-parity references only. Their READMEs must say they are legacy reference material and not used by the native shipping lane. Root package scripts and native packaging scripts must continue to avoid Electron, `electron-builder`, legacy WebUI boot, admin source fallback, and admin `node_modules` staging.

The public setup payload must also stay clean. `RoachNetSource` inside the `.app` bundles may include the native API, setup backend, shared first-party helpers, collections, and setup UI. It must not include admin/WebUI source, Electron source, GitHub workflow state, local memory, legacy launchers, audit scripts, smoke scripts, tests, databases, ZIM payloads, or user-machine paths.

## Required Checks

- `npm install --package-lock-only --ignore-scripts --dry-run`
- `npm --prefix admin install --package-lock-only --ignore-scripts --dry-run`
- `npm audit --json`
- `npm --prefix admin audit --json`
- `node scripts/audit-native-release-scope.mjs`
- `node scripts/audit-native-parity.mjs`
- `node scripts/audit-runtime-freshness.mjs`

The native release-scope audit enforces manifest/lockfile section alignment, Blacksmith runner labels, Node 26 native workflow pins, the Node 24 admin exception, native packaging guards, loopback default bindings, and absence of machine-specific paths in release-gate metadata and script tests.

The upstream project audit enforces latest stable release metadata for the major projects RoachNet borrows patterns from: ES-DE, Ascendara, Hydra, Vortex, Owncast, and Hermes Agent. Moving default-branch commits are recorded as audit context, but stable release drift blocks a public build.
