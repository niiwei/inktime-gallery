# InkTime Gallery Architecture

This document describes the current local-first macOS app architecture.

## Runtime Shape

- `electron/main.js` starts the packaged macOS app, prepares runtime folders, imports the embedded Express server, owns tray/menu actions, and manages the wallpaper LaunchAgent lifecycle.
- `server/index.js` is the local API server. It owns configuration, SQLite access, source scanning, model calls, rendering, curation, wallpaper application, and long-running process state.
- `src/ui/App.tsx` is the React UI. It talks to the server through `/api/*` and should not own model, database, rendering, or macOS side effects.
- Packaged app runtime config lives in `~/Library/Application Support/inktime-gallery/config/gallery.config.json`.
- Packaged app runtime data lives in `~/Library/Application Support/inktime-gallery/data/`.

## Main API Routes

- `GET /api/config`: read normalized config.
- `PUT /api/config`: save config, including model, processing, wallpaper, and layout template settings.
- `GET /api/photos?collection=representative|all|curated`: read processed gallery items.
- `GET /api/sources?status=all|pending|processed|skipped|failed|processing`: read source inventory.
- `POST /api/sources/scan`: scan the configured image directory and refresh skip state without calling the model.
- `POST /api/process`: process new, rerun, or selected source images.
- `POST /api/process/stop`: request a safe stop and abort active model calls.
- `GET /api/process/progress`: read current long-running task state and AGUI events.
- `POST /api/rerender`: regenerate rendered images and wallpapers from existing analysis data.
- `POST /api/photos/:id/curated`: add or remove a processed photo from the curated set.
- `POST /api/photos/:id/wallpaper`: set one processed photo as the macOS wallpaper.
- `POST /api/wallpaper/random`: choose a wallpaper from the configured wallpaper collection and apply it.
- `POST /api/library/clear`: clear SQLite records and generated render/wallpaper files without deleting originals.

## SQLite Data Model

- `source_photos`: source-file inventory. It stores path, file hash, perceptual hash, EXIF capture time/date, dimensions, orientation, processing status, and skip reason.
- `processed_photos`: AI output and derived assets. It stores model/run metadata, rendered/wallpaper URLs, memory score, captions, tags, token usage, similarity group, and representative flag.
- `curated_photos`: user-curated processed photo IDs.
- `wallpaper_history`: applied wallpaper history used to avoid immediate repeats.
- `metadata`: internal migration markers.

Legacy JSON import exists for older local data. New features should treat SQLite as the source of truth.

## Processing Lifecycle

1. Scan the image directory with `listImageFiles`.
2. Upsert every source into `source_photos` with file hash, perceptual hash, EXIF/date, dimensions, and orientation.
3. Refresh source skip state:
   - processed sources become `processed`;
   - screenshot filename matches become `skipped`;
   - exact duplicate file hashes become `skipped`;
   - near-duplicate/burst photos use perceptual hash distance plus capture-time proximity.
4. Full processing selects only `status='pending'`; selected processing can intentionally override selected source IDs.
5. Each processed image calls the vision model for JSON analysis and then for a side caption.
6. The app renders `/renders/*.png` and `/wallpapers/*.jpg`, then writes processed data to SQLite.
7. After processing, processed photos are assigned similarity groups and representatives for gallery filtering.

Long-running tasks expose progress through `/api/process/progress`. The UI should treat progress polling as authoritative because a long `/api/process` request can disconnect while the backend keeps working.

## Model Calls

- Local Ollama is detected when `providerBaseUrl` points to `localhost`, `127.0.0.1`, or port `11434`.
- Ollama requests use `/api/chat`, stream responses, send compressed JPEG input, and set `num_ctx=8192`.
- Model input images are resized to longest edge 1024px before upload to local Ollama.
- Active model calls can be aborted by `POST /api/process/stop`.
- A single model call times out after 240 seconds.
- A streaming Ollama response is aborted if it has no output for 90 seconds.

## Layout Rendering

The render pipeline supports layout templates for `portrait`, `landscape`, and `square` images.

- Templates are stored in config under `layoutTemplates`.
- Each template has canvas size, background, and semantic layers: `photo`, `caption`, `date`, `place`, and `score`.
- Layers support position, size, visibility, and text style. Photo layers support fit and radius.
- The layout editor edits these templates visually.
- The editor's "save layout and rerender" action saves config and calls `/api/rerender`.
- Rerendering does not call the model; it reuses stored captions, scores, and source paths.
- Rendered image and wallpaper static routes disable caching, and rerendered URLs add a version query so the UI shows fresh files.

## Wallpaper Automation

Wallpaper source is controlled by `wallpaperCollection`:

- `representative`: processed representative photos.
- `all`: all AI-processed photos.
- `curated`: only curated photos.

Automatic wallpaper changes are scheduled by a macOS LaunchAgent managed from `electron/main.js`. The app installs, updates, or removes `~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist` according to `wallpaperAutoIntervalHours`.

- every 1 hour: every whole hour;
- every 2/4/8 hours: whole hours divisible by the interval;
- disabled: the LaunchAgent is unloaded and removed.

The LaunchAgent runs `scripts/set-random-wallpaper.js` directly, so scheduled wallpaper changes do not depend on the InkTime Gallery window or embedded server being open. The script reads the runtime config and SQLite database, applies the wallpaper, verifies the actual macOS desktop path, and only then writes `wallpaper_history`.

## Gallery Collections

- `All Sources` / `全部图片`: every source file discovered in the configured folder, including pending, processed, skipped, failed, and processing states.
- `Representative` / `代表照片`: processed photos where `is_representative=1`; currently this may equal all processed photos if no similarity group was formed.
- `AI All` / `AI 全部照片`: every processed photo.
- `Curated` / `精选照片`: processed photos explicitly added to `curated_photos`.

The detail page supports keyboard browsing: left/right arrows move within the current filtered gallery order, and `F` toggles curated status.

## Known Boundaries

- Similarity grouping is conservative visual near-duplicate detection, not semantic grouping.
- The app is local-first and Mac-focused; no cloud sync or automatic deletion of originals.
- Runtime packaged config and data live under the user application support folder, not the repository `config/` and `data/` paths.
