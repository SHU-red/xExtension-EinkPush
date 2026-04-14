# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
