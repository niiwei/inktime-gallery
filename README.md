<div align="center">
  <img src="public/brand/inktime-mark.svg" alt="InkTime logo" width="96" height="96">

  # InkTime Gallery

  English | [简体中文](README.zh-CN.md)

  A local-first macOS photo memory gallery that turns your own pictures into AI-written captions, printable frame cards, and rotating desktop wallpapers.

  [![Build](https://github.com/niiwei/inktime/actions/workflows/build.yml/badge.svg)](https://github.com/niiwei/inktime/actions/workflows/build.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
  [![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-black.svg)](#download)
  [![Ollama](https://img.shields.io/badge/Ollama-ready-0f766e.svg)](#local-models)
</div>

## About

InkTime Gallery is a personal macOS app for revisiting a large local photo library. It scans a folder, tracks every source image in SQLite, asks a local or OpenAI-compatible vision model to describe the memory value of each photo, then renders gallery cards and macOS wallpapers.

It is built for private, local-first use: your photos, generated database, rendered images, and wallpaper history stay on your machine.

## Table Of Contents

- [Features](#features)
- [Download](#download)
- [Quick Start](#quick-start)
- [Local Models](#local-models)
- [How It Works](#how-it-works)
- [Development](#development)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Features

- Full-folder source inventory with per-photo states: pending, processed, skipped, failed, and processing.
- Local Ollama support by default, with OpenAI-compatible provider settings available in config.
- AI-generated Chinese captions, tags, memory scores, reasons, and short bottom captions.
- Visual gallery for all sources, representative photos, AI-processed photos, and curated photos.
- Figma-like frame layout editor for portrait, landscape, and square templates.
- One-click rerendering without recalling the model.
- macOS wallpaper rendering, manual wallpaper setting, and random wallpaper rotation.
- System-level wallpaper scheduling through a macOS `LaunchAgent`.
- Safe stop controls for long-running image processing.
- Keyboard browsing in detail view with left/right arrows and `F` for curation.

## Download

The recommended user install is a GitHub Release asset:

- `InkTime.dmg` for ordinary macOS users.
- Source code for developers who want to modify or build the app.

Current release target:

- macOS on Apple Silicon.
- Unsigned local build. The first launch may require approval in macOS security settings.

## Quick Start

For end users:

1. Download `InkTime.dmg` from [Releases](https://github.com/niiwei/inktime/releases).
2. Open the DMG and move `InkTime.app` into `Applications`.
3. Start Ollama and make sure your vision model is available.
4. Open InkTime, choose a photo folder, scan, then process selected photos.

For developers:

```bash
npm install
npm run electron:dev
```

## Local Models

The default config is designed for local Ollama:

```json
{
  "providerBaseUrl": "http://127.0.0.1:11434",
  "apiKeyEnvName": "",
  "model": "qwen3-vl:8b"
}
```

Model input images are resized to a longest edge of 1024px before being sent to Ollama, and Ollama requests use `num_ctx=8192`.

For online providers, copy [.env.example](.env.example) and set the relevant API key locally. Do not commit `.env` or `.env.local`.

## How It Works

InkTime is one app with several local parts:

| Layer | Path | Role |
| --- | --- | --- |
| Desktop shell | `electron/` | Starts the macOS window, tray menu, runtime folders, and LaunchAgent management. |
| Local API | `server/` | Owns config, SQLite, scanning, model calls, rendering, and wallpaper side effects. |
| UI | `src/ui/` | React interface for gallery, processing, settings, curation, and layout editing. |
| Background script | `scripts/` | Independent wallpaper script used by macOS `launchd`. |
| Docs | `docs/` | Architecture, roadmap, visual notes, and upstream reading notes. |

Packaged app data is stored outside the repository:

```text
~/Library/Application Support/inktime-gallery/config/
~/Library/Application Support/inktime-gallery/data/
```

The repository does not include your personal photos, runtime SQLite database, generated renders, wallpapers, logs, or local environment files.

## Wallpaper Automation

Automatic wallpaper rotation is handled by macOS, not by an always-running app timer.

InkTime installs or updates this LaunchAgent:

```text
~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist
```

At the configured whole-hour schedule, macOS starts `scripts/set-random-wallpaper.js`. The script reads runtime config and SQLite directly, applies the wallpaper, verifies the actual macOS desktop path, and only then writes `wallpaper_history`.

Sleeping Macs do not run scheduled tasks while asleep; the next scheduled trigger runs after the machine is awake.

## Development

Run the browser-style development server:

```bash
npm run dev
```

Run the Electron app in development mode:

```bash
npm run electron:dev
```

Build the web assets:

```bash
npm run build
```

Package a local macOS app directory:

```bash
npm run electron:pack
```

Build a distributable DMG:

```bash
npm run electron:dist
```

## Project Structure

```text
.
├── electron/              # Electron main process and LaunchAgent manager
├── server/                # Embedded Express API and local processing logic
├── scripts/               # Independent wallpaper automation script
├── src/                   # React app and shared frontend types
├── config/                # Default config template
├── assets/                # App icons and tray assets
├── public/                # Public static assets
├── docs/                  # Architecture, roadmap, and design notes
└── reference/InkTime/     # Read-only upstream reference material
```

## Roadmap

- Persistent batch queue for very large photo libraries.
- Better burst-photo grouping and representative selection.
- More wallpaper pools and quality filters.
- Database backup, restore, health checks, and repair actions.
- Token and cost visibility by run, day, month, and model.

See [docs/personal-roadmap.md](docs/personal-roadmap.md) for the longer version.

## Contributing

Pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep changes focused, and run:

```bash
npm run build
```

before opening a PR.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- Upstream reference: [InkTime](reference/InkTime/)
- README structure inspired by [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
- Markdown syntax reference: [guodongxiaren/README](https://github.com/guodongxiaren/README)
