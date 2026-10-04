# InkTime Gallery Personal Roadmap

This document tracks future work for using InkTime Gallery as a personal large-scale photo processing and wallpaper manager.

Treat this file as the living product-planning document for InkTime Gallery. It is safe to edit directly when you want to record feature ideas, priorities, UX notes, or longer-term product direction.

## Current Baseline

- The app runs as an Electron desktop app with an embedded local server. The 0.2.0 test build shares the business layer across macOS and Windows 11 x64; system wallpaper and scheduling remain platform adapters.
- Processing results are stored in SQLite, with legacy JSON migration kept for existing data.
- The database separates source photos, processed photos, curated photos, and wallpaper history.
- The app scans the whole configured folder into a source-photo inventory before processing and reuses unchanged file features by size and modification time.
- Source photos track pending, processed, skipped, failed, and processing states, including skip reasons.
- The processing UI shows persistent task stages, progress, AGUI events, token usage, and pause/resume/cancel/retry controls. Tasks and checkpoints survive refresh and restart.
- Active model calls can be aborted, have a 240 second total timeout, and Ollama streams have a 90 second no-output timeout.
- Rendered wallpaper images are generated separately from the original image render.
- Rendered frame layouts are configurable through a visual layout editor for portrait, landscape, and square templates.
- Gallery and source queries are paginated and filterable on the server, defaulting to 60 items; the UI uses cached thumbnails and a visible-area virtual list.
- The layout editor supports session undo, alignment, single-image preview, and saving templates separately from batch rerender tasks.
- AI results can be edited for caption, date, and location. Manual values, wallpaper exclusion, representative changes, and group splits are stored separately and survive AI reruns until explicitly restored.
- Settings expose model checks, import directory selection, database backup/restore, and library health checks. Schema upgrades create a consistency backup before migration.
- macOS wallpaper can be set from the app, either randomly or from an individual photo detail page.
- The wallpaper source and auto-update interval are configurable in the app settings.
- Automatic wallpaper updates are scheduled by a macOS LaunchAgent managed by the app.
- The gallery detail page supports keyboard browsing with left/right arrows and `F` for curation.
- The active LaunchAgent is `~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist`; it runs the independent wallpaper script against the runtime config and SQLite database.
- Windows NSIS x64 packaging, a no-window `--wallpaper-once` entry, and Task Scheduler lifecycle scripts are present for the Windows 11 test build. Real Windows system acceptance is still pending.

### Validation boundary

- `npm test` currently passes 17/17 isolated API and migration/task cases.
- `npm run build` passes TypeScript and Vite production compilation.
- Browser smoke uses real Chrome, a temporary database, and synthetic duplicate images. The current 1k/10k sample recorded first-screen timings of 89/68 ms and 72/69 ms for cold/warm runs, with 20 mounted cards and no page errors. These numbers are a regression signal, not a claim about a 1k/10k real-photo library.
- Desktop smoke covers a packaged macOS launch in 463/750/2273 ms across three runs (latest internal window creation 240 ms; real-library startup still pending), real isolated rendering, close-window continuation, quit pause, and restart recovery with system integration disabled.
- Live-model smoke covers one synthetic PNG through the configured Qwen3-VL-8B path in 20.6 seconds and 2,803 tokens.
- A reversible macOS system-wallpaper smoke passed set/readback and restored both original desktop paths. Login/wake scheduling, Windows 11 x64 installation/upgrade/uninstall, Task Scheduler, primary-screen wallpaper readback, and a real large photo library remain to be accepted on the corresponding machines.

## Batch Processing

- Add background-friendly processing limits: max concurrency, daily token budget, and quiet hours.
- Add a background import scanner that detects new files without requiring a manual scan.

## Duplicate And Burst Handling

- Improve the current perceptual-hash burst grouping with better quality signals such as sharpness, face visibility, AI scores, and user curation.
- Keep all originals in the source database while hiding non-representative items from the default representative gallery and wallpaper pool.
- Add merge-group and richer quality controls around the existing representative, split-group, and wallpaper-exclusion actions.
- Add semantic grouping separately from near-duplicate grouping if needed; do not use semantic similarity for automatic skipping by default.

## Wallpaper Management

- Add high-memory-score and custom-filter wallpaper pools beyond the current representative, all processed, and curated modes.
- Improve the existing recent-history exclusion with candidate quality and user-configurable windows.
- Add seasonal and time-aware selection, such as matching month/day, daytime/nighttime, or travel date.
- Add quality filters for wallpaper use: exclude screenshots, low resolution, blurry images, food-only images, or private photos if requested.
- Extend the existing next-update and last-error display with actionable repair guidance.

## SQLite Hardening

- Add indexes for common filters: capture time, total score, curated status, representative status, and wallpaper history.
- Add a repair action that can rebuild derived renders and wallpaper images from existing source records.

## Cost And Token Visibility

- Store prompt tokens, completion tokens, total tokens, model name, and request status per processed photo.
- Show total token usage and estimated cost by run, day, month, and model.
- Add a pre-processing estimate before starting a large batch.
- Use local prefilters before AI calls: screenshot detection, duplicate detection, image size checks, and EXIF-based skips.
- Consider a two-tier pipeline: cheap local or small-model triage first, full vision analysis only for promising photos.

## Personal Automation

- Add a background scan option for selected folders.
- Add an automation dashboard with queue status, processed count, skipped count, token usage, next wallpaper time, and latest error.
- Add a safe recovery flow after app crash or machine restart.
- Add export/import for settings, curated photo lists, and wallpaper history.
- Keep private-use defaults conservative: no cloud sync, no automatic deletion of originals, and no irreversible cleanup without confirmation.
