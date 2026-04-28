# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] - 2026-04-28
### Added
- **3-State Auto-Push Status**: Live indicator shows countdown (🔔), pushing (⚡), or cooldown (⏸️)
- `daemonStatusAction` endpoint for real-time daemon state polling

## [1.2.2] - 2026-04-28
### Added
- **Auto-Push Daemon**: Runs independent of page loads, sleeps to ping interval, pushes all enabled sources on device online
- Live countdown to next ping (cooldown + interval)
### Changed
- Push tab: Settings (folder) + Push (auto-push toggle + 3 number inputs) sections
- Header: Last Push + Next Ping countdown (only when auto-push enabled)
### Fixed
- `!empty()` fails on FreshRSS magic config properties (cast to int)
- `posix_kill()` guarded with `function_exists()` for PHP without posix extension

## [1.2.1] - 2026-04-28
### Fixed
- Push tab UI: renamed to Settings + Auto Push sections, 3 number inputs in row, fixed missing i18n for retries label
- Auto Push status bar: compact inline display with last ping/push/next countdown

## [1.2.0] - 2026-04-28
### Added
- **Auto-Push Status UI**: Live countdown to next ping, last ping/push status display
- **Granular Progress**: Per-article progress tracking during push/download
- **Background Worker**: Non-blocking push via CLI worker (survives page reloads)
- **Readability Integration**: Full-text extraction via configurable API
- **Native Sidebar Button**: Split button matches FreshRSS style exactly

### Changed
- **Hardcoded retry delay**: 5 seconds fixed, removed UI field
- **Dark orange sidebar button**: Centered text, gear icon, matching borders
- **Unified push workflow**: All buttons share same progress overlay & connection test

### Fixed
- **Worker crashes**: Undefined `$maxArticles`, deprecated nullable params, CLI bootstrap
- **Progress modal stalling**: JS polling timer resets, premature file deletion
- **Config key mismatches**: `screenWidth`, `readability_url` alignment
- **Sidebar width**: Exact native dimension matching via computed styles

## [1.1.8] - 2026-04-14
### Added
- **Auto-Push (Device Status)**: New primary delivery method that pings your device's `/api/status` endpoint.
- **Smart Cooldown**: Configurable ping interval and push cooldown to prevent redundant deliveries.
- **Auto-Directory Creation**: The extension now automatically creates remote folders via `/mkdir` if they don't exist.
### Removed
- **Cron Scheduling**: Obsolete Cron-based scheduling has been replaced by the more reliable Device Status ping method.

## [1.1.7] - 2026-04-14
### Added
- **Real-Time Progress Dashboard**: Visual progress bar during "Push All" operations.
- **Live Preview**: "Preview Latest" button to see how Readability cleans an article before exporting.
- **Smart Scheduling**: Quick-select dropdown for common Cron schedules.
- **Endpoint Health Check**: "Test Connection" button to verify your push endpoint.
- **API Security**: "Regenerate Token" button for the REST API.
- **Interactive Logs**: Improved history view with auto-refresh indicators.

## [1.1.6] - 2026-04-14

### Changed
- Updated REST API text to highlight it is experimental.
- Implemented `showDirectoryPicker` for "Download all" to allow saving multiple files to a selected folder.
- Updated button texts for clarity ("EinkPush", "Download all", "Push all").

## [1.1.1] - 2026-04-13

### Changed
- Improved error handling and logging for ZipArchive creation.
- Improved error handling and logging for cURL requests.
- Changed multiple download triggering to use iframes with delays instead of a single ZIP file.
- Added a loading overlay with a spinner to provide visual feedback during long operations.

## [1.1.0] - 2026-04-12

### Added
- Automatic log cleanup (keeps last 14 days or 100 entries).
- Versioning system with `metadata.json` and `CHANGELOG.md`.
- Version display in the settings menu.
- Logging for skipped articles due to fetch failures.

### Changed
- Sidebar button text reverted to "reading push".
- Articles failing readability fetch are now automatically excluded from the push and article limit.

### Fixed
- Sidebar button visibility issues when toggled in settings.
- EPUB generation logic to ensure consistent article counts.

## [1.0.0] - 2026-04-12

### Added
- Initial release of EinkPush extension.
- Support for EPUB generation from favorites and categories.
- Readability API integration for full content extraction.
- Push to device via REST endpoint.
- Cron support for automated delivery.
