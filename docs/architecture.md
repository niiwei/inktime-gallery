# InkTime Gallery Architecture

This document describes the current local-first cross-platform architecture for the 0.2.0 test build. The business layer is shared by macOS and Windows; system wallpaper, scheduling, and desktop shell behavior remain platform adapters.

## Runtime Shape

- `electron/main.js` starts the packaged app, prepares runtime folders, imports the embedded Express server, owns tray/menu actions, and manages the platform scheduler lifecycle. `--wallpaper-once` is the no-window entry used by scheduled wallpaper runs.
- `server/index.js` is the local API server. It owns configuration, SQLite access, source scanning, model calls, rendering, curation, wallpaper selection, and route registration.
- `server/library-service.js` owns schema migration, consistency backups, paginated queries and source-version metadata. Incremental inventory is coordinated by `server/index.js`; backup/health HTTP routes live in `server/upgrade-routes.js`.
- `server/task-engine.js` owns persistent tasks, task items, checkpoints, recovery, pause/resume/cancel/retry, and per-item progress.
- `server/platform/` contains the platform wallpaper adapter. macOS keeps the existing system integration; Windows calls the bundled PowerShell/C# bridge for `IDesktopWallpaper`.
- `scripts/windows/` contains the Windows scheduler and installer lifecycle scripts. `scripts/set-random-wallpaper.js` remains the shared scheduled selection entry.
- `src/ui/App.tsx` is the React UI. It talks to the server through `/api/*` and should not own model, database, rendering, or macOS side effects.
- Packaged app runtime config and data live below Electron's `app.getPath('userData')`; on macOS this defaults to `~/Library/Application Support/inktime-gallery/`.
- `assets/fonts/` contains the licensed bundled Noto Chinese font and its license note. `tests/` uses temporary roots and never the user's library.

## Main API Routes

- `GET /api/config`: read normalized config.
- `PUT /api/config`: save config, including model, processing, wallpaper, and layout template settings.
- `GET /api/photos` and `GET /api/sources`: return `{ items, total, page, pageSize }` with server-side collection/status/date/location/score filters and stable sorting. The default page size is 60. Items expose `thumbnailUrl`, `wallpaperExcluded`, and `manualEdits` where applicable.
- `POST /api/sources/scan`: scan the configured image directory and refresh skip state without calling the model.
- `POST /api/process` and `POST /api/rerender`: create persistent tasks and return `202 { taskId }`; they do not hold the request open for the model run.
- `GET /api/tasks` and `GET /api/tasks/:id`: read tasks and task items. Task status is `queued|running|paused|done|cancelled|error`; task actions are exposed at `/pause`, `/resume`, `/cancel`, and `/retry`.
- `POST /api/process/stop`: compatibility alias for pausing the active task. `GET /api/process/progress` retains the legacy progress shape and adds paused/cancelled state.
- `GET/PATCH /api/photos/:id`: read or update manual caption/date/location edits, restore AI values, and wallpaper exclusion; a successful edit creates a single-photo rerender task.
- `POST /api/photos/:id/representative` and `/split-group`: persist group corrections. `POST /api/photos/batch` applies curated or wallpaper-excluded changes to source IDs or a fixed filter selection.
- `GET /api/wallpaper/status`, `POST /api/wallpaper/random`: read wallpaper state and apply a candidate through the platform adapter.
- `POST /api/system/select-directory`, `POST /api/models/check`, and `POST /api/layout/preview`: support the import guide and single-image layout preview.
- `GET /api/library/backups`, `POST /api/library/backup`, `POST /api/library/restore`, `GET /api/library/health`: expose backup, restore, and consistency checks.
- `POST /api/library/clear`: clear SQLite records and generated render/wallpaper files without deleting originals.

## SQLite Data Model

- `source_photos`: source-file inventory. It stores path, file hash, perceptual hash, EXIF capture time/date, dimensions, orientation, processing status, and skip reason.
- `processed_photos`: AI output and derived assets. It stores model/run metadata, rendered/wallpaper URLs, memory score, captions, tags, token usage, similarity group, representative flag, manual edits, and wallpaper exclusion.
- `curated_photos`: user-curated processed photo IDs.
- `wallpaper_history`: applied wallpaper history used to avoid immediate repeats.
- `tasks` and `task_items`: persistent task configuration, per-item stage/result, checkpoints, errors, and progress counters.
- `metadata`: internal migration markers. SQLite `PRAGMA user_version` records schema version (currently 3); processed source hashes distinguish current results from changed originals.

Legacy JSON import exists for older local data. Schema upgrades create a consistency backup before migration and preserve source IDs, curated rows, groups, and wallpaper history. New features should treat SQLite as the source of truth.

## Processing Lifecycle

1. Scan the image directory with `listImageFiles`.
2. Upsert every source into `source_photos` with file hash, perceptual hash, EXIF/date, dimensions, and orientation.
3. Refresh source skip state:
   - processed sources become `processed`;
   - screenshot filename matches become `skipped`;
   - exact duplicate file hashes become `skipped`;
   - near-duplicate/burst photos use perceptual hash distance plus capture-time proximity.
4. A process request creates a persistent task. Full processing selects `status='pending'`; selected processing can intentionally override selected source IDs, and filter selections are resolved when the task is created.
5. Each task item resumes only from a checkpoint whose source file version and configuration snapshot still match. Each processed image calls the vision model for JSON analysis and then for a side caption.
6. The app renders `/renders/*.png` and `/wallpapers/*.jpg`, writes the item result in a short transaction, and keeps the previous derived files until the new files are ready.
7. At task completion, processed photos are assigned similarity groups and representatives for gallery filtering. Manual edits take display and render precedence and are not overwritten by AI reruns unless explicitly restored.

Long-running tasks expose progress through `/api/tasks` and `/api/process/progress`. The UI treats the persistent task record as authoritative on refresh and startup; the legacy progress route remains for compatibility.

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
- The editor supports undo, alignment, and a single-image preview. Saving templates uses `PUT /api/config` only; batch rerender is a separate task from `/api/rerender`.
- Rerendering does not call the model; it reuses stored captions, scores, and source paths.
- Rendered image and wallpaper static routes disable caching, and rerendered URLs use unique versioned filenames so the UI shows fresh files.

## Wallpaper Automation

Wallpaper source is controlled by `wallpaperCollection`:

- `representative`: processed representative photos.
- `all`: all AI-processed photos.
- `curated`: only curated photos.

Automatic wallpaper changes are scheduled by a macOS LaunchAgent or the Windows current-user Task Scheduler, managed from `electron/main.js` and `scripts/windows/`. The app installs, updates, or removes the platform task according to `wallpaperAutoIntervalHours`.

- every 1 hour: every whole hour;
- every 2/4/8 hours: whole hours divisible by the interval;
- disabled: the LaunchAgent is unloaded and removed.

The scheduler runs the no-window `--wallpaper-once` entry directly, so scheduled wallpaper changes do not depend on the InkTime Gallery window or AI queue being open. Shared selection excludes recent history and progressively relaxes the exclusion when the candidate pool is too small. The platform adapter applies the wallpaper, verifies the system result, and only then writes `wallpaper_history`. Reversible macOS wallpaper set/readback and an isolated LaunchAgent run after app exit passed, including one-run-per-boundary catch-up. RunAtLoad checks the current boundary at login; actual login/wake and Windows integration still require device acceptance. Install the macOS app in Applications; unattended runs from protected Documents can wait on privacy access.

## Gallery Collections

- `All Sources` / `全部图片`: every source file discovered in the configured folder, including pending, processed, skipped, failed, and processing states.
- `Representative` / `代表照片`: processed photos where `is_representative=1`; currently this may equal all processed photos if no similarity group was formed.
- `AI All` / `AI 全部照片`: every processed photo.
- `Curated` / `精选照片`: processed photos explicitly added to `curated_photos`.

The detail page supports keyboard browsing: left/right arrows move within the current filtered gallery order, and `F` toggles curated status.

## Known Boundaries

- Similarity grouping is conservative visual near-duplicate detection, not semantic grouping.
- The app is local-first; no cloud sync or automatic deletion of originals. The 0.2.0 Windows target is Windows 11 x64 and its system integration is not yet real-device accepted.
- Runtime packaged config and data live under the user application support folder, not the repository `config/` and `data/` paths.
