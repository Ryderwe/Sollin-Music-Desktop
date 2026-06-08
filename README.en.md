# Sollin

<p>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"></a>
  <a href="https://github.com/Ryderwe/Sollin-Music-Desktop-OpenSource/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Ryderwe/Sollin-Music-Desktop-OpenSource?style=flat-square"></a>
  <a href="https://github.com/Ryderwe/Sollin-Music-Desktop-OpenSource/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Ryderwe/Sollin-Music-Desktop-OpenSource?include_prereleases&style=flat-square"></a>
  <img alt="Electron 28" src="https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white&style=flat-square">
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=20232A&style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white&style=flat-square">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square">
</p>

[中文](README.md) | English

Sollin is a cross-platform desktop music player built with Electron, React, TypeScript, Vite and Tailwind CSS. It focuses on local playback and online playback. Local playback covers the local library, playlists, lyrics, downloads and backups. Online playback depends on user-imported LX JS source scripts.

Sollin Desktop has been open source since version `1.3.1`. This open-source edition does not include private server account, activation, announcement or server cloud backup features. It also does not include private source scripts or private music APIs.

## Contents

- [Requirements](#requirements)
- [Configuration](#configuration)
- [Install](#install)
- [Development](#development)
- [Build](#build)
- [Package Desktop Apps](#package-desktop-apps)
- [GitHub Actions Packaging](#github-actions-packaging)
- [Update Checking](#update-checking)
- [Source Configuration](#source-configuration)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Native Modules](#native-modules)
- [Troubleshooting](#troubleshooting)
- [Open Source Notes](#open-source-notes)
- [Acknowledgements](#acknowledgements)
- [License](#license)
- [Star History](#star-history)

## Requirements

- Node.js 20 is recommended. Node.js 18 or newer should also work.
- npm 9 or newer.
- Git.
- Build desktop packages on the target OS when possible:
  - Build Windows installers on Windows.
  - Build macOS installers on macOS.
  - Build Linux installers on Linux.

Electron cross-packaging is possible in limited cases, but native modules, signing and installer tooling are more reliable on the target platform.

## Configuration

Copy the example environment file:

```bash
cp .env.example .env.local
```

Available variables:

```env
VITE_APP_VERSION=1.3.1
VITE_DEV_SERVER_PORT=5173
VITE_GITHUB_REPO=Ryderwe/Sollin-Music-Desktop-OpenSource
```

Configuration reference:

- `VITE_APP_VERSION`: current app version, used by Settings and update checks.
- `VITE_DEV_SERVER_PORT`: Vite dev server port.
- `VITE_GITHUB_REPO`: GitHub repository used for update checks, in `owner/repo` format.

The open-source edition does not require a private service URL. Do not commit `.env.local`, tokens, certificates, local machine paths or internal API documents.

## Install

```bash
npm install
```

For reproducible CI or release builds:

```bash
npm ci
```

## Development

Start the web renderer only:

```bash
npm run dev
```

Start the full Electron desktop app:

```bash
npm run electron:dev
```

The default Vite dev server port is `5173`. You can change it with `VITE_DEV_SERVER_PORT`.

## Build

Build the renderer and Electron main process:

```bash
npm run build
```

Build only the renderer:

```bash
npm run build:web
```

Compile only the Electron main process:

```bash
npm run electron:compile
```

Preview the Vite production build:

```bash
npm run preview
```

## Package Desktop Apps

Packaged files are written to `release/`.

### Current Platform

```bash
npm run electron:build
```

### Windows

Run on Windows:

```bash
npm run electron:build:win
```

Explicit x64 build:

```bash
npm run electron:build:win:x64
```

Configured outputs:

- NSIS installer: `release/*.exe`
- Portable executable: `release/*.exe`

### macOS

Run on macOS:

```bash
npm run electron:build:mac
```

Apple Silicon:

```bash
npm run electron:build:mac:arm64
```

Intel:

```bash
npm run electron:build:mac:x64
```

Configured outputs:

- Disk image: `release/*.dmg`
- ZIP archive: `release/*.zip`

Unsigned local builds can use:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run electron:build:mac
```

For public macOS distribution, configure Apple Developer signing and notarization credentials for electron-builder.

### Linux

Run on Linux:

```bash
npm run electron:build:linux
```

Explicit x64 build:

```bash
npm run electron:build:linux:x64
```

Configured outputs:

- AppImage: `release/*.AppImage`
- Debian package: `release/*.deb`

On Debian or Ubuntu builders, install common packaging tools if needed:

```bash
sudo apt-get update
sudo apt-get install -y libarchive-tools
```

## GitHub Actions Packaging

The workflow at `.github/workflows/package.yml` builds Windows, macOS Intel, macOS Apple Silicon and Linux packages.

Manual packaging:

1. Open GitHub Actions.
2. Select `Package Desktop Apps`.
3. Click `Run workflow`.
4. Download artifacts from the completed run.

Release packaging by tag:

```bash
git tag v1.3.1
git push origin v1.3.1
```

Pushing a `v*` tag builds all configured platforms and creates a GitHub Release with artifacts. Manual release publishing is also available with the `publish_release` workflow input.

## Update Checking

The open-source edition checks GitHub Releases for updates. The app reads the latest release from the repository configured by `VITE_GITHUB_REPO` and selects a matching asset for the current platform when possible.

Recommended release flow:

1. Update the version in `package.json` and `.env.example`.
2. Build and package the app.
3. Create a tag such as `v1.3.2`.
4. Upload Windows, macOS and Linux packages to the GitHub Release.

## Source Configuration

Online playback and online search rely on LX JS source scripts imported by the user. This repository does not include private, paid or built-in source scripts.

In the desktop app, open Settings and use source management to:

- import an LX JS source from a URL;
- import a local LX JS source file;
- switch the active source;
- enable or disable update alerts per source;
- inspect supported platforms, actions and quality levels reported by the source script.

Only use source scripts, music APIs and content that you are allowed to use.

## Features

### Playback

- Play, pause, previous and next controls.
- Sequence, list loop, single loop and shuffle modes.
- Volume and mute controls.
- Seekable progress bar.
- Media Session integration for system media controls.
- Mini player mode.
- Configurable close behavior on Windows and macOS.
- System tray controls.
- Global shortcuts for play or pause, previous and next.
- Audio output device selection when `setSinkId` is available.

### Online Music

- Online search and playback through user-imported LX JS source scripts.
- Multi-platform online search.
- Aggregate search.
- Online song, album, artist, playlist and toplist pages.
- Recommended playlists and playlist square browsing.
- Daily recommendations and personal FM when supported by an account source.
- Online favorites.
- Imported online playlists with refresh and optional auto-update.
- Source fallback when the current source cannot play a song.
- Playback quality selection with common, lossless and high-resolution labels when supported.

### Local Music

- Local folder scanning.
- Local library views by song, album and artist.
- Local favorites.
- Local playlists.
- Local file metadata reading.
- Local song tag editor.
- Embedded lyrics, translated lyrics, romanized lyrics and word-timed lyrics where metadata is available.
- External same-name lyric and cover fallback.
- Configurable local tag priority between embedded metadata and external files.

### Playlists and Library

- Create and delete local playlists.
- Add songs to playlists from song menus and player menus.
- Drag sorting for sidebar playlists.
- Import online playlists.
- Convert supported online albums or playlists into local playlists.
- Recently played list.
- Separate online and local favorites.

### Lyrics

- Standard lyric display.
- Apple Music-like lyric display.
- TTML lyric rendering.
- Word-by-word lyric display when data is available.
- Translation and romanization display.
- Lyric page and player lyric settings.
- Electron desktop lyrics window.
- Desktop lyric lock and unlock.
- macOS menu bar lyrics.
- Bottom bar lyric preview.

### Downloads

- Download songs from the desktop app.
- Download task management page.
- Custom download directory.
- Custom file naming rules.
- Metadata writing after download.
- Optional sidecar `.lrc` lyric and cover image export.

### Audio Effects

- Audio visualization.
- Equalizer presets and custom gains.
- Reverb presets.
- Spatial audio controls.
- Playback rate control.
- Album-cover, fluid and visual background modes for the player experience.

### Data, Backup and Sync

- Local JSON export and import.
- Selectable backup items.
- WebDAV backup and restore.
- LAN data synchronization inspired by lx-music-desktop behavior.
- Host and client modes for local network sync.
- Sync selected library data, dislike rules, download rules and selected interface settings.
- Data cache and audio cache with size limits and clear controls.

### Interface

- Light, dark and system themes.
- Responsive Electron window layout.
- Sidebar collapse and expand.
- Search history.
- Settings grouped by source, data, download, local music, appearance, shortcuts, audio and about sections.

### Removed in the Open-Source Edition

- Private server account login, registration and sessions.
- Paid unlocking and device binding.
- Private announcements and global notices.
- Server cloud backup.
- Update checks through a private service.
- Configuration delivery through a private service.

## Tech Stack

- Electron 28
- React 18
- TypeScript
- Vite 5
- Tailwind CSS
- Zustand
- React Router
- Radix UI
- Framer Motion
- electron-builder

## Project Structure

```text
.
├── electron/                 Electron main process, preload scripts and desktop IPC
├── src/
│   ├── components/           Shared React components
│   ├── pages/                Route pages
│   ├── services/             Playback, search, download, backup and sync services
│   ├── stores/               Zustand stores
│   ├── types/                Shared TypeScript types
│   ├── utils/                Utility functions
│   ├── App.tsx               App routes and top-level effects
│   └── main.tsx              Renderer entry
├── build/                    Icons and native resources used by electron-builder
├── public/                   Public static assets
├── index.html                Main renderer HTML
├── desktop-lyrics.html       Desktop lyrics renderer HTML
├── package.json              Scripts, dependencies and electron-builder config
└── vite.config.ts            Vite configuration
```

## Native Modules

This project includes Electron native-module usage:

- `node-taglib-sharp` for audio tag operations.
- `build/Release/qrc_decode.node` for native lyric decoding fallback.

The included `qrc_decode.node` binary is platform-specific. If you package for another OS or architecture and that feature is required, build or provide the matching native binary and update the `build/Release` resource layout accordingly.

If the native lyric decoder is missing, the app attempts JavaScript decoding first and falls back gracefully where possible.

## Troubleshooting

### `npm run electron:dev` cannot connect to Vite

Check the dev server port:

```bash
VITE_DEV_SERVER_PORT=5174 npm run electron:dev
```

### macOS app is blocked after packaging

Unsigned local builds may be blocked by Gatekeeper. For private testing, open the app from Finder with the context menu. For public distribution, sign and notarize the app.

### Windows packaging fails

Close running app instances and clear `release/`, then run the packaging command again from a clean shell. Antivirus tools may also lock output files.

### Online playback fails

Check that a valid source script is imported and active. Also verify that the source script supports the selected platform and quality.

### Update checking fails

Confirm that `VITE_GITHUB_REPO` points to a public repository and that the repository has at least one GitHub Release.

## Open Source Notes

- Do not commit `.env.local`, tokens, private service URLs, signing certificates, local machine paths or internal API documents.
- This repository keeps only the desktop client code and does not include private service implementations or private source scripts.
- If a secret or real service URL was ever committed to another repository, rotate it even if it has since been removed.
- Before publishing, review Git history, release artifacts and CI logs for sensitive information.
- Follow the licenses and terms of third-party code, source scripts, music APIs and content services.
- This project is a client application. You are responsible for the legality of the sources, APIs and content you configure.

## Acknowledgements

Sollin is an independent project, but it benefits from the ideas and ecosystem built by these open-source projects:

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop): reference and inspiration for desktop music player behavior, local data workflows, sync concepts and the LX source script ecosystem.
- [Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics): lyric rendering libraries used for Apple Music-like lyric experiences.
- Electron, React, Vite, TypeScript, Tailwind CSS and the broader open-source ecosystem.

## License

MIT. See [LICENSE](LICENSE).

## Star History

<a href="https://star-history.com/#Ryderwe/Sollin-Music-Desktop-OpenSource&Date">
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Ryderwe/Sollin-Music-Desktop-OpenSource&type=Date">
</a>
