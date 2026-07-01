# InkTime Personal Roadmap

This document tracks future work for using InkTime as a personal large-scale photo processing and wallpaper manager.

## Current Baseline

- The app runs as an Electron macOS desktop app with an embedded local server.
- Processing results are stored in SQLite, with legacy JSON migration kept for existing data.
- The database separates source photos, processed photos, curated photos, and wallpaper history.
- The app scans the whole configured folder into a source-photo inventory before processing.
- Source photos track pending, processed, skipped, failed, and processing states, including skip reasons.
- The processing UI shows progress, AGUI events, token usage, and a stop button.
- Active model calls can be aborted, have a 240 second total timeout, and Ollama streams have a 90 second no-output timeout.
- Rendered wallpaper images are generated separately from the original image render.
- Rendered frame layouts are configurable through a visual layout editor for portrait, landscape, and square templates.
- macOS wallpaper can be set from the app, either randomly or from an individual photo detail page.
- The wallpaper source and auto-update interval are configurable in the app settings.
- Automatic wallpaper updates are scheduled by a macOS LaunchAgent managed by the app.
- The gallery detail page supports keyboard browsing with left/right arrows and `F` for curation.
- The active LaunchAgent is `~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist`; it runs the independent wallpaper script against the runtime config and SQLite database.

## Batch Processing

- Add a persistent task queue for large photo libraries, so processing can pause, resume, retry failed items, and continue after app restart.
- Track per-run status in SQLite: started time, finished time, selected model, prompt version, token usage, failures, and skipped photos.
- Add queue controls in the app beyond the current stop button: pause, resume, cancel queued items, and retry failed.
- Add background-friendly processing limits: max concurrency, daily token budget, and quiet hours.
- Add a background import scanner that detects new files without requiring a manual scan.

## Duplicate And Burst Handling

- Improve the current perceptual-hash burst grouping with better quality signals such as sharpness, face visibility, AI scores, and user curation.
- Keep all originals in the source database while hiding non-representative items from the default representative gallery and wallpaper pool.
- Add manual override actions: mark as representative, split group, merge group, and never use as wallpaper.
- Add semantic grouping separately from near-duplicate grouping if needed; do not use semantic similarity for automatic skipping by default.

## Wallpaper Management

- Add high-memory-score and custom-filter wallpaper pools beyond the current representative, all processed, and curated modes.
- Avoid recent repeats by reading `wallpaper_history` before choosing the next image.
- Add seasonal and time-aware selection, such as matching month/day, daytime/nighttime, or travel date.
- Add quality filters for wallpaper use: exclude screenshots, low resolution, blurry images, food-only images, or private photos if requested.
- Show the next scheduled wallpaper update time and the last failure reason in the app.

## SQLite Hardening

- Add explicit schema migrations instead of relying only on `create table if not exists`.
- Add indexes for common filters: capture time, total score, curated status, representative status, and wallpaper history.
- Add backup and restore actions from the app settings.
- Add database health checks: missing source files, missing rendered files, orphan processed rows, and invalid wallpaper paths.
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
