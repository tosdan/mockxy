# Mockxy 1.2.0

Testo da integrare manualmente nella release GitHub già pubblicata. Le note generate
automaticamente hanno incluso soltanto i commit provenienti da pull request.

## Desktop

- Restores every workspace tab that was open when the app closed.
- Adds `--no-restore-workspaces` for recovery starts without reopening workspaces.
- Prevents concurrent desktop instances and focuses the existing window on a second launch.
- Checks GitHub Releases for stable updates from portable Windows and AppImage builds.
- Shows the installed and latest version under **App preferences → Updates**.
- Adds a workspace-level global response delay, persisted in the workspace configuration.

## Headless server

- Reads the global response delay from `MOCKXY_DELAY` and `MOCKXY_DELAY_ALL` in `.env`.
- Documents creating `.env` from `.env.example` before configuring backend URL, port and other
  deployment-specific values.

## Other changes

- Adds an optional path prefix when importing OpenAPI specifications.
- Includes the WebSocket runtime dependency in packaged desktop builds.
- Adds a tag-driven GitHub Actions workflow that tests and creates draft desktop releases with
  Windows portable, Linux AppImage and SHA-256 checksums.

**Full changelog:** https://github.com/tosdan/mockxy/compare/v1.1.0...v1.2.0
