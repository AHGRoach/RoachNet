# RoachNet

RoachNet is an offline-first command center for local knowledge, AI, maps, utilities, and operator workflows when the internet is unavailable or unreliable.

This repository uses an open-source upstream base from [Crosstalk Solutions](https://github.com/Crosstalk-Solutions/project-nomad) and is being adapted into a broader day-to-day offline operations platform with local AI, guided onboarding, and user-manageable agents and skills.

## Upstream Base

- Upstream base: `Crosstalk-Solutions/project-nomad`
- Imported into this repo on 2026-03-27
- Imported from upstream commit `5c92c8981304424e37d38f74ef7e80d78fe82a13`
- Local git setup keeps `origin` pointed at `AHGRoach/RoachNet` and adds `upstream` for the imported source repo

RoachNet also exposes a separate upstream sync path in the app at `Settings -> Update -> Source Upstream Sync`. That flow fetches `upstream/main`, creates a backup branch, replays the RoachNet patchset onto a temporary refreshed upstream worktree, and then validates the refreshed checkout with the admin typecheck/build before switching the main branch over.

RoachNet preserves upstream attribution and currently carries forward the Apache 2.0 licensing shipped with the imported upstream base.

## Current Foundation

The imported base already provides:

- an offline-first management UI and API in [`admin/`](./admin)
- install, start, stop, update, and uninstall scripts in [`install/`](./install)
- curated content collections in [`collections/`](./collections)
- local Ollama chat and RAG plumbing
- settings, maps, docs, benchmarking, and easy-setup flows

## Quick Start

From the repo root on macOS:

```bash
npm start
```

That root launcher now:

- starts the local RoachNet server from [`admin/`](./admin)
- waits for the app to become healthy on the configured local URL
- opens the web UI in the default browser at `/home`

If you want to start the server without opening a browser tab:

```bash
npm run start:no-browser
```

## RoachNet Direction

RoachNet extends the base toward an all-in-one offline utility for normal day-to-day operations during disaster scenarios, network outages, or disconnected field use.

Planned RoachNet-specific work includes:

1. OpenClaw integration alongside the existing Ollama stack
2. A unified settings surface for Ollama and OpenClaw configuration
3. An agent and skill management UI for adding, configuring, and operating local workflows
4. A guided onboarding flow that explains each step, option, and tradeoff to the user
5. Additional offline tools that keep the machine operational without relying on a live network connection

## Immediate Next Steps

1. Rebrand key docs, assets, and UI copy from the imported upstream product name to RoachNet
2. Map existing Ollama, settings, and easy-setup surfaces to RoachNet feature requirements
3. Add the first OpenClaw service layer and API endpoints
4. Extend the onboarding flow to cover Ollama, OpenClaw, agents, and skills
5. Define persistent configuration models for local providers, agents, skills, and onboarding state

## Repo Notes

- See [`docs/UPSTREAM.md`](./docs/UPSTREAM.md) for import provenance and sync notes
- See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the initial RoachNet implementation plan
- See [`docs/LOCAL_BOOT.md`](./docs/LOCAL_BOOT.md) for the verified macOS local-dev boot path
- See [`docs/SURFACE_MAP.md`](./docs/SURFACE_MAP.md) for the current settings, onboarding, and Ollama integration map

## License

This repository currently includes the upstream Apache 2.0 license from the imported base. Review [`LICENSE`](./LICENSE) and [`docs/UPSTREAM.md`](./docs/UPSTREAM.md) before changing licensing or attribution details.
