# Upstream Provenance

RoachNet is currently based on an imported open-source upstream codebase.

## Source

- Upstream repository: `https://github.com/Crosstalk-Solutions/project-nomad`
- Imported on: 2026-03-27
- Imported commit: `5c92c8981304424e37d38f74ef7e80d78fe82a13`
- Import method: shallow clone to a temporary workspace, then file-level copy into this repository without upstream `.git` history

## Local Git Setup

The local checkout now has:

- `origin` -> `https://github.com/AHGRoach/RoachNet.git`
- `upstream` -> `https://github.com/Crosstalk-Solutions/project-nomad.git`

`upstream` is a local remote only. It is not part of the repository contents, but it makes future comparison and selective sync work easier.

## Upstream Sync Path

RoachNet now carries a separate upstream sync flow alongside the normal app release updater.

- UI path: `Settings -> Update -> Source Upstream Sync`
- Sync strategy: fetch `upstream/main`, create a safety backup branch, generate a RoachNet patchset from the tracked upstream baseline in [`roachnet.upstream.json`](../roachnet.upstream.json), replay that patchset into a temporary upstream worktree, then run admin `typecheck` and `build`
- Persistence model: RoachNet branding, UI changes, provider integrations, and other custom modifications remain intact because the sync process replays the RoachNet patchset onto the new upstream tree before switching the main branch over
- Overlay handling: RoachNet-owned documentation and branding surfaces are treated as overlay-managed files, so upstream doc churn does not strip the RoachNet product identity during sync

Operational requirements:

1. The checkout must be on a named git branch, not detached HEAD
2. Tracked working-tree changes must be committed or reverted first
3. If patch replay or rebuild fails, RoachNet aborts the sync, leaves the main branch untouched, and preserves a backup branch for recovery

## Licensing

The imported source tree includes an Apache 2.0 `LICENSE` file from the upstream base. RoachNet should continue preserving upstream attribution while the codebase remains substantially derived from that source.

Before changing legal metadata, confirm:

1. whether any imported package metadata needs alignment with the Apache 2.0 top-level license
2. whether new RoachNet branding requires a `NOTICE` file or additional attribution language
3. whether any newly added dependencies introduce incompatible license terms

## Known Extension Points

The base app already exposes good seams for RoachNet work:

- `admin/start/routes.ts` defines existing chat, Ollama, settings, and easy-setup routes
- `admin/app/controllers/ollama_controller.ts` and `admin/app/services/ollama_service.ts` are natural entry points for provider expansion
- `admin/app/controllers/settings_controller.ts` backs the current settings pages
- `admin/app/controllers/easy_setup_controller.ts` drives the onboarding flow
- `admin/inertia/pages/settings/` already contains model and system settings UI
- `admin/inertia/pages/easy-setup/` already contains the guided setup pages

These should be extended first instead of building a parallel configuration stack.
