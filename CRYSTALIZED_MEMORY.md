# Durable project context

Pixel Workshop shares its pixel-art engine across the browser editor and MCP tools. Production Vercel uses private Blob storage and isolated workspaces; the Sites copy uses a separate store. See [README](README.md) for the boundaries and recovery instructions.

Stardrop at `/play/moonkeeper` is a separate playable experience in the same app. Both it and the editor expose [player-friendly release notes](lib/player-release-notes.ts), distinct from technical commit history.
