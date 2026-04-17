# RoachNet Project Memory

## Canonical Workspace

- Desktop app repo: `/Volumes/Parodox/DEVPROJECTS/RoachNet`
- iOS companion repo: `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS`
- Website repo: `/Volumes/Parodox/DEVPROJECTS/roachnet-org`
- Homebrew tap: `/Volumes/Parodox/DEVPROJECTS/homebrew-roachnet`
- SideStore repo: `/Volumes/Parodox/DEVPROJECTS/RoachNet-SideStore`
- Wiki/docs repo: `/Volumes/Parodox/DEVPROJECTS/RoachNet-wiki`

Do not use `/Volumes/Black/...` for active RoachNet work. The live work is on the Parodox drive.

## Current Release Targets

- Desktop app package version: `1.0.3`
- Website package version: `1.0.3`
- iOS companion marketing version: `0.1.3`

The target release in progress is `RoachNet v1.0.3`, but it must not be shipped until the installer lane, Homebrew lane, runtime bootstrap, GUI shell, and cross-surface compatibility are actually green.

## Latest Checkpoint: 2026-04-17

This checkpoint closed the contained runtime regression that was blocking packaged installs and release-gate verification.

### Key fixes landed

- `scripts/run-roachnet.mjs`
  - fixed compiled-runtime database preparation so it writes the prepared stamp into the managed runtime state root instead of the undefined `RUNTIME_HOME` path
  - this stopped the packaged runtime from failing early and falling back into the source boot lane
- `scripts/smoke-test-macos-install-lanes.mjs`
  - hardened the GUI smoke harness so window verification accepts the target process having one or more windows instead of requiring a strict title-only match
  - this removed the false negative where `RoachNet Setup` was visibly open but the smoke still timed out
- `native/macos/Sources/RoachNetApp/VaultContextSupport.swift`
  - added a shared vault preview/type resolver plus RoachClaw excerpt extraction support
- `native/macos/Sources/RoachNetApp/VaultPreviewSurface.swift`
  - added built-in readers/players for markdown, folder, PDF, audio, and video assets
- `native/macos/Sources/RoachNetApp/main.swift`
  - defaulted RoachClaw context permissions to enabled
  - added the all-context command-bar toggle
  - expanded the permissioned RoachClaw context block to include vault excerpts and open-asset excerpts
- `native/macos/Sources/RoachNetApp/DevWorkspaceView.swift`
  - added recent command history, exit-code state, path chips, and a stronger terminal/status presentation
- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/Features/Vault/VaultView.swift`
  - moved the vault toward a shelf-card/archive presentation so the phone lane reads closer to the desktop shell

### Rebuilt / repackaged in this checkpoint

- Rebuilt the native macOS bundles with:
  - `ROACHNET_SKIP_DMG=1 node scripts/build-native-macos-apps.mjs`
- This refreshed:
  - `native/macos/dist/RoachNet.app`
  - `native/macos/dist/RoachNet Setup.app`
  - both bundled `RoachNetSource.tar.gz` archives
  - both embedded runtime payloads

### Verification evidence from this checkpoint

- `xcrun swift test --package-path native/macos`
  - passed
- `node scripts/smoke-test-command-bar-lane.mjs`
  - passed
- `node scripts/smoke-test-macos-install-lanes.mjs`
  - passed
  - confirmed:
    - setup GUI window verification
    - contained setup install lane
    - packaged runtime health
    - installed GUI app health
    - Homebrew-style lane
- `node scripts/smoke-test-release-gates.mjs`
  - passed
  - confirmed:
    - packaged bundle versions
    - setup-app install lane
    - Homebrew install lane
    - command bar gate
    - desktop + iOS companion compatibility
    - Apps catalog contract (`307` items, `15` map packs, `9` model packs)
- `./scripts/build_unsigned_ipa.sh` inside `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS`
  - passed
  - produced:
    - `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/dist/RoachNetiOS-v0.1.3-unsigned.ipa`
    - size: `1682440`
    - sha256: `217447ef97e6da61c2e45172a8a099c549fce6dac3627c74991dda6a9828afba`
    - build timestamp: `2026-04-17T07:35:27Z`

### Release-facing repo updates made in this checkpoint

- Website repo `/Volumes/Parodox/DEVPROJECTS/roachnet-org`
  - updated home and iOS marketing copy to reflect:
    - full-context RoachClaw
    - IDE-like Dev workspace / stronger terminal lane
    - archive-style vault shelf
    - closer desktop/iOS parity
- SideStore repo `/Volumes/Parodox/DEVPROJECTS/RoachNet-SideStore`
  - updated `apps.json` from `0.1.2` to `0.1.3`
  - refreshed IPA URL, size, date, and screenshot lead image
- iOS repo `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS`
  - updated README and SideStore docs from `0.1.2` to `0.1.3`

## Product Direction

RoachNet is being pushed toward a contained, offline-first local computing product that feels closer to a finished consumer application than a pile of modules.

Core direction:

- Keep the whole stack close to the machine.
- Treat the internet as optional, not foundational.
- Keep AI, notes, packs, projects, runtime, and archives in one contained environment.
- Prefer local-first and privacy-respecting behavior.
- Move branding from the older magenta/pink direction toward `#9138D8`.
- Use the website Mission-page copy voicing across the desktop app, iOS app, setup app, site, docs, and related surfaces.
- Preserve the desktop Home hero line: `Home Is Where The Roach Is!`

## Brand / Voice Rules

- Main site landing label is `Mission`, not `Why`.
- The Mission landing copy is custom-written and should not drift away from the approved text spine.
- Across desktop and iOS, copy should sound more like the Mission page:
  - clearer
  - calmer
  - less technical
  - less repetitive
  - less dashboard-like
- Avoid surfaces that read like stacked modules, status cards, or control panels when a simpler editorial or product-oriented composition is possible.

## Main Product Surfaces

### Desktop

- `Home`
  - first shell after setup
  - should feel like a polished command center, not a metrics dashboard
- `RoachClaw`
  - must be chat-first like the site RoachClaw surfaces
  - should support local-first model routing plus hosted fallback
  - should be able to access vault/projects/app state when the user explicitly grants permission
- `Dev`
  - should feel more like Cursor / a real IDE
  - editor, shell, secrets, RoachBrain, and assist should feel like one coherent workbench
  - terminal should feel like a real terminal, closer to Ghostty than a generic text box
- `Vault`
  - archive and vault are merged here
  - should behave like a clean library/archive interface
  - imported content should present as animated shelf items, not plain rows
  - music, video, books, PDFs, notes, folders, and packs should preview/open inside RoachNet
- `Maps`, `Education`, `Runtime`, `RoachTail`
  - should still exist as real system lanes but not fragment the overall product feel

### iOS

- Must feel like the same product as the desktop app, not a side project
- RoachClaw/chat should be closer to the site and desktop chat surfaces
- Apps surface needs a clean UI pass and correct CTA layout
- Motion should not cause labels, buttons, or text to drift around the screen
- Companion pairing and App installs must stay aligned with the desktop runtime and Apps catalog

### Website

- Main landing page is the Mission page at `roachnet.org/`
- Previous homepage now lives at `/home/`
- Apps site, Accounts site, API page, RoachClaw pages, iOS page, and docs should all share the newer Mission-page voice

## Non-Negotiable Constraints

- Do not ship a release that includes the user's indexed docs or private library content.
- Do not assume Homebrew or host-level prerequisites just to start setup on Apple Silicon.
- Do not keep reopening or packaging the wrong app bundle.
- Do not use old installed copies when validating the GUI.
- Do not ship half-fleshed features.
- Do not claim installer or Homebrew success without actually re-running the smokes.

## Current Bundle / Install State

Old installed copies were intentionally removed to stop bundle confusion:

- removed: `/Users/roach/Applications/RoachNet.app`
- removed: `/Users/roach/RoachNet/app/RoachNet.app`

The active build under development is:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/dist/RoachNet.app`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/dist/RoachNet Setup.app`

Installer behavior now needs to replace older installed copies automatically instead of allowing multiple stale app bundles to coexist.

## Important Desktop Work Already Added

### 1. Command Bar Expansion

The native command palette has been extended toward a real launcher/control surface.

Added command targets:

- reveal storage root
- reveal install root
- reveal projects root
- import Obsidian vault
- stage actionable prompts into RoachClaw
- toggle RoachClaw context scopes

Relevant file:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/main.swift`

Release-gate smoke added:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-command-bar-lane.mjs`

### 2. Setup / Runtime Recovery

The native shell no longer relies only on `setupCompletedAt` to decide whether the workspace is ready. It now treats a prepared install as completed when the real contained workspace is present.

This prevents the shell from getting stuck behind:

- `Finish setup. Then the full shell opens.`

Relevant file:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/main.swift`

### 3. Old Install Replacement During Setup

The setup flow now:

- terminates running old RoachNet app processes
- removes stale installed app copies outside the intended target
- installs the new bundle cleanly

Relevant file:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/run-roachnet-setup.mjs`

### 4. Vault / Library Work

The Vault now already includes:

- imported Obsidian vault support
- markdown note editing against the same files Obsidian reads
- Quick Look driven preview surfaces
- support for EPUB / PDF / audio / video preview lanes
- App Store installs surfaced as shelf items inside the Vault
- captured web folded into the Vault instead of a separate archive product

Relevant files:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/VaultPreviewSurface.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/VaultShelfViews.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/VaultWorkspaceStore.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/main.swift`

### 5. RoachClaw Context Access

RoachClaw context permissions already exist for:

- vault
- archives / captured web
- projects
- roachnet app state

The app context block is already being injected into RoachClaw/dev assist when the relevant permissions are enabled.

Relevant files:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/main.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/DevWorkspaceView.swift`

### 6. Speech / Voice Work

A `RoachSpeechController` file already exists and AVFoundation-based speech plumbing is in the tree.

Relevant file:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/RoachSpeechController.swift`

## Important iOS Work Already Added

- Apps install CTA labels were shortened from `Install to RoachNet` to `Install` to stop mobile layout breakage.
- Chat surface has already been shifted toward a more thread-first layout.
- Broader motion/layout cleanup is still incomplete.

Relevant files:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/Features/Apps/AppsView.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/Features/Chat/ChatView.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/Features/Vault/VaultView.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/App/CompanionRootView.swift`

## Important Website / Surface Work Already Added

- Mission landing page on `roachnet.org/`
- old homepage moved to `/home/`
- shared Mission-style copy voicing across pages
- Apps site with selected-app promoted preview behavior
- shared RoachClaw web interface across main site and accounts site
- auth-gated RoachClaw web shell
- footer Netlify badge support
- stronger sidebar/category motion on the Apps store

Relevant repo:

- `/Volumes/Parodox/DEVPROJECTS/roachnet-org`

## Still Open / Still Needs Work

### Desktop

- RoachClaw should be even more chat-first and closer to the site layout/design while keeping native-only functionality.
- Dev still needs another pass to feel more like a real IDE.
- Terminal still needs more fidelity and polish to feel like a serious terminal lane.
- Command bar expansion needs to continue toward a real Raycast alternative.
- Vault cards and interactions still need richer animated library behavior.
- Runtime should come up faster so setup does not time out waiting for the setup runtime.
- Desktop copy should be cleaned up further to align with Mission-page voice.

### iOS

- Apps layout still needs cleanup on smaller screens.
- Motion still moves content instead of only moving decorative layers.
- RoachClaw/chat needs to feel more like the desktop/site chat surface.
- Top layout and scaling issues need more verification in simulator and screenshots.
- iOS and desktop still need closer feature and style parity.

### Packaging / Release

- Installer lane must be revalidated after the recent setup and bundle-replacement fixes.
- Homebrew lane must be revalidated after the same changes.
- GUI must be confirmed visible and stable on the correct Parodox bundle before any release.
- New screenshots still need to be taken from the correct build only, with no personal info, no cursor, and no wallpaper.
- A release must not be pushed while any of the above is uncertain.

## Required Release Gates

These should all be green before shipping `v1.0.3`:

1. `xcrun swift build --package-path /Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos`
2. `ROACHNET_SKIP_DMG=1 node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/build-native-macos-apps.mjs`
3. `node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-command-bar-lane.mjs`
4. `node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-macos-install-lanes.mjs`
5. `node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-release-gates.mjs`
6. iOS build succeeds for the companion
7. desktop GUI opens the correct Parodox dist app and stays visible
8. setup app completes cleanly
9. Homebrew install lane completes cleanly
10. Apps catalog compatibility still passes across desktop and iOS

## Known Good Commands

### Desktop

```bash
xcrun swift build --package-path /Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos
xcrun swift test --package-path /Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos
ROACHNET_SKIP_DMG=1 node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/build-native-macos-apps.mjs
node --check /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/run-roachnet-setup.mjs
node --check /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/run-roachnet.mjs
node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-command-bar-lane.mjs
node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-macos-install-lanes.mjs
node /Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-release-gates.mjs
```

### iOS

Use `xcodebuild` against:

- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion.xcodeproj`

Unsigned IPA packaging:

```bash
cd /Volumes/Parodox/DEVPROJECTS/RoachNet-iOS
./scripts/build_unsigned_ipa.sh
```

### Website

```bash
node /Volumes/Parodox/DEVPROJECTS/roachnet-org/scripts/build-apps-site.mjs
node /Volumes/Parodox/DEVPROJECTS/roachnet-org/scripts/build-accounts-site.mjs
```

## App Store / Catalog Contract

The Apps website and native install handlers are expected to remain aligned.

Recent compatibility smoke confirmed:

- `307` items
- `15` map packs
- `9` model packs

This contract must remain valid as Vault/App Store/desktop/iOS work continues.

## Screenshot / Publishing Rules

- Always capture from the correct new build, not an older shell.
- Never include personal information.
- Never include wallpaper or the desktop.
- Never include the cursor in published screenshots.
- Do not use cropped screenshots that hide the content the page is supposed to show.
- Desktop and iOS screenshots on the website must reflect the actual build being shipped.

## Current High-Priority Files

- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/main.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/DevWorkspaceView.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/VaultPreviewSurface.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/VaultShelfViews.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetApp/VaultWorkspaceStore.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/native/macos/Sources/RoachNetSetup/main.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/run-roachnet-setup.mjs`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/run-roachnet.mjs`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet/scripts/smoke-test-command-bar-lane.mjs`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/Features/Apps/AppsView.swift`
- `/Volumes/Parodox/DEVPROJECTS/RoachNet-iOS/RoachNetCompanion/Features/Chat/ChatView.swift`
- `/Volumes/Parodox/DEVPROJECTS/roachnet-org/index.html`
- `/Volumes/Parodox/DEVPROJECTS/roachnet-org/home/index.html`
- `/Volumes/Parodox/DEVPROJECTS/roachnet-org/app-store.js`

## Current Working Rule

Desktop is the priority until:

- the correct Parodox shell is unquestionably stable
- installer/Homebrew/runtime/GUI are green
- RoachClaw, Dev, Vault, and command bar feel complete enough to justify a release

Do not ship just because the code compiles.
