# CLAUDE.md

This file is read by Claude Code at the start of every session in this repo.

The contributor and AI-agent guide lives in **[AGENTS.md](AGENTS.md)** — start there. It covers repo layout, setup, daily commands, code style, commit conventions, and what not to touch.

## Fork notes

This fork diverges from upstream WhiskeySockets/Baileys:

- **Built-in group metadata cache** (`src/Socket/messages-send.ts`), active unless the caller supplies `cachedGroupMetadata`. Invalidated on group events, not by expiry.
- **`disableLinkPreviews`** config option, to skip the blocking URL fetch on the send path.
- **Video duration and dimensions** (`src/Utils/video-metadata.ts`), read from the MP4/MOV container in-process. Upstream only computed duration for audio.
- Upstream governance docs, CI workflows, demo media, and release/docs tooling were removed. `yarn build:docs`, `yarn release`, and the changelog scripts no longer exist.
- `src/__tests__/e2e/send-receive-message.test-e2e.ts` still references the deleted `Media/` fixtures and will fail if the e2e suite is ever run.
