# 📱 EinkPush

**Your personal E-ink delivery service for FreshRSS.**

EinkPush turns your FreshRSS feeds into beautifully formatted EPUB files, optimized specifically for e-ink readers. Whether you want to download them manually or have them automatically pushed to your device, EinkPush makes reading your news a distraction-free experience.

![Dashboard](assets/screenshot.png)

## ✨ Key Features

*   **Smart Content Selection**: Export specific categories or your starred "Favorites".
*   **Automatic Delivery**: Schedule cron jobs to automatically push new content to your device via a simple HTTP endpoint.
*   **Device-Specific Optimization**: Custom screen dimensions and font scaling ensure your EPUBs look perfect on any e-reader.
*   **Full-Text Extraction**: Optional Readability API integration to fetch full article content for truncated feeds.
*   **Native Integration**: A clean, orange "EinkPush" button fits right into your FreshRSS sidebar.
*   **Multi-File Downloads**: Download all your enabled sources at once with a single click.

## 📸 In Action

<p align="center">
  <img src="assets/xteink_x4_02.jpg" width="30%" />
  <img src="assets/xteink_x4_01.jpg" width="30%" />
  <img src="assets/xteink_x4_03.jpg" width="30%" />
</p>

## 🚀 Quick Start

1.  **Install**: Clone this repo into your FreshRSS `extensions/` folder as `xExtension-EinkPush`.
2.  **Enable**: Go to *Settings > Extensions* in FreshRSS and enable **EinkPush**.
3.  **Configure**: Click the **📱 EinkPush** button in your sidebar to set your screen size and select your content.
4.  **Read**: Download your EPUBs or set up an endpoint for automatic delivery.

## 🛠️ Development & Releases

This project uses a structured versioning and release system.

### Versioning
Versions are defined consistently across:
- `metadata.json` (FreshRSS requirement)
- `extension.php` (`VERSION` constant)
- `CHANGELOG.md` (Release notes)

### How to Release
1.  **Update Version**: Update the version number in `metadata.json` and `extension.php`.
2.  **Update Changelog**: Add the new version entry to `CHANGELOG.md`.
3.  **Run Release Script**: Run `php scripts/release.php` to verify consistency and create a local zip package.
4.  **GitHub Release**: Push a tag starting with `v` (e.g., `git tag v1.1.0 && git push origin v1.1.0`).
    - A GitHub Action will automatically create a release, attach the changelog, and upload the extension zip.

---
*Vibe-coded with AI. Built to solve a daily reading workflow.*
