# InkTime Gallery v0.1.0

First public macOS preview release.

## Highlights

- Local-first Electron macOS app for personal photo memory browsing.
- Full source-folder scan with SQLite-backed source and processing states.
- Ollama-ready vision model pipeline, defaulting to `qwen3-vl:8b`.
- AI captions, tags, memory scores, reasons, and short bottom captions.
- Rendered frame cards and macOS wallpaper images.
- Visual layout editor with save-and-rerender workflow.
- Representative, AI all, curated, and all-source gallery views.
- Keyboard browsing and `F` shortcut for curation.
- Manual and random wallpaper setting.
- System-level wallpaper rotation through macOS LaunchAgent.

## Download

- `InkTime.dmg` for Apple Silicon macOS.

## Notes

- This build is unsigned. macOS may require manual approval on first launch.
- Runtime config and data are stored under `~/Library/Application Support/inktime-gallery/`.
- Photos, generated renders, wallpapers, SQLite databases, and `.env` files are not included in the repository.
- Local Ollama is the default model provider. Online providers can be configured with local environment variables.
