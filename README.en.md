# Sollin｜A music playback client that is compatible with both online and local music.

<p>

Blog: [月明星稀](https://www.ymxx.net)

[中文](README.md) | English
  <a href="https://github.com/Ryderwe/Sollin-Music-Desktop/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Ryderwe/Sollin-Music-Desktop?include_prereleases&style=flat-square"></a>
  <a href="https://github.com/Ryderwe/Sollin-Music-Desktop/releases"><img alt="Total release downloads" src="https://img.shields.io/github/downloads/Ryderwe/Sollin-Music-Desktop/total?style=flat-square&label=Total%20Release%20Downloads&color=F08AA8"></a>
  <img alt="Repository views" src="https://visitor-badge.laobi.icu/badge?page_id=Ryderwe.Sollin-Music-Desktop&left_text=Repository%20Views&left_color=%235B78FF&right_color=%23F08AA8">
  <img alt="Electron 28" src="https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white&style=flat-square">
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=20232A&style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white&style=flat-square">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square">
</p>


[中文](README.md) | English

Sollin is a cross-platform desktop music player built with Electron, React, TypeScript, Vite and Tailwind CSS. It focuses on local playback and online playback. Local playback covers the local library, playlists, lyrics, downloads and backups. Online playback depends on user-imported LX JS source scripts.

Sollin Desktop has been open source since version `1.3.1`. This open-source edition does not include private server account, activation or server cloud backup features. It also does not include private source scripts or private music APIs. Announcements can optionally be read from public GitHub Issue comments and do not depend on a private backend.

## Contents

- [Requirements](#requirements)
- [Configuration](#configuration)
- [Install](#install)
- [Development](#development)
- [Build](#build)
- [Package Desktop Apps](#package-desktop-apps)
- [GitHub Actions Packaging](#github-actions-packaging)
- [Update Checking](#update-checking)
- [Announcement Configuration](#announcement-configuration)
- [Source Configuration](#source-configuration)
- [Preview](#preview)
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
VITE_GITHUB_REPO=Ryderwe/Sollin-Music-Desktop
VITE_GITHUB_ANNOUNCEMENT_REPO=Ryderwe/Sollin-Music-Desktop
VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER=1
VITE_GITHUB_ANNOUNCEMENT_AUTHOR=ryderwe
```

Configuration reference:

- `VITE_APP_VERSION`: current app version, used by Settings and update checks.
- `VITE_DEV_SERVER_PORT`: Vite dev server port.
- `VITE_GITHUB_REPO`: GitHub repository used for update checks, in `owner/repo` format.
- `VITE_GITHUB_ANNOUNCEMENT_REPO`: GitHub repository used for announcement comments, in `owner/repo` format. Defaults to `VITE_GITHUB_REPO`.
- `VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER`: Issue number used for announcements. The official default is `1`; set it explicitly to an empty value to disable announcement checks.
- `VITE_GITHUB_ANNOUNCEMENT_AUTHOR`: only comments published by this GitHub user are shown. Defaults to `ryderwe`.

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

## Announcement Configuration

The open-source edition can read announcements from public GitHub Issue comments. After `VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER` is configured, the app requests the comments API for that Issue on startup and shows only the latest comment published by `VITE_GITHUB_ANNOUNCEMENT_AUTHOR`. After the user closes it, the app records it locally as read; editing the same comment will show it again.

Usage:

1. Create a fixed public Issue in the repository, for example with the title `Announcements`.
2. Publish announcement comments in that Issue only from the `ryderwe` account.
3. Set the Issue number in `.env.local` as `VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER`.

This feature only calls GitHub's public API. It does not need a token and does not connect to a private backend.

## Source Configuration

Online playback and online search rely on LX JS source scripts imported by the user. This repository does not include private, paid or built-in source scripts.

In the desktop app, open Settings and use source management to:

- import an LX JS source from a URL;
- import a local LX JS source file;
- switch the active source;
- enable or disable update alerts per source;
- inspect supported platforms, actions and quality levels reported by the source script.

Only use source scripts, music APIs and content that you are allowed to use.

## Preview

- ![AM Player](images/am播放界面.png)
- ![Online Home](images/在线首页.png)
- ![Local Home](images/本地首页.png)
- ![Classic Player](images/经典播放界面.png)
- ![Settings](images/设置首页.png)

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
- Private backend announcements and global notices.
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
- [Mineradio](https://github.com/XxHuberrr/Mineradio.git): source and reference for the ported Mineradio playback visual engine, stage lyrics and motion effects.
- [Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics): lyric rendering libraries used for Apple Music-like lyric experiences.
- Electron, React, Vite, TypeScript, Tailwind CSS and the broader open-source ecosystem.

- [linux.do](https://linux.do): Linux & AI community.

## License

MIT. See [LICENSE](LICENSE).

## Star History

<a href="https://www.star-history.com/?type=date&repos=Ryderwe%2FSollin-Music-Desktop">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Ryderwe/Sollin-Music-Desktop&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Ryderwe/Sollin-Music-Desktop&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Ryderwe/Sollin-Music-Desktop&type=date&legend=top-left" />
 </picture>
</a>
