> **Vibe-coded with AI.** This extension was built entirely with AI assistance. No manual PHP was written. It exists solely to solve a daily personal workflow — nothing more, nothing less.

# xExtension-EinkPush2

> ⚠️ **Work in Progress** — This extension is under active development. Settings consistency and push functionality are not yet implemented.

A [FreshRSS](https://github.com/FreshRSS/FreshRSS) extension that exports selected feed categories (or starred articles) into a simple, self-contained EPUB file sized for small e-ink readers like the XTe Ink X4. Pick your categories, set your screen dimensions, hit a button, and read your feeds offline — distraction-free, in about three minutes of setup.

## How it works

1. **Configure** — In the FreshRSS extension settings, tick the categories you want and enter your e-reader's screen width and height in pixels.
2. **Generate** — Click *Generate & Download EPUB*. The extension pulls the cached article content from FreshRSS (no external re-fetching), wraps it in a clean, e-ink-friendly EPUB 3 file, and serves it as a download.
3. **Read offline** — Transfer the `.epub` to your device and read without connectivity or distractions.

> ⚠️ **Missing Features**
> - Settings consistency across sessions
> - Push functionality to automatically send EPUB to devices

## Install

1. Download or clone this repository into the `extensions/` directory of your FreshRSS installation so the folder is named `xExtension-EinkPush2`.
2. Enable the extension in FreshRSS under *Settings > Extensions*.
3. Open the extension configuration, select categories, set screen size, and save.

## Configuration options

| Setting | Default | Description |
|---|---|---|
| Categories | *(none)* | Which feed categories to include |
| Include favorites | off | Also export starred/favorite articles |
| Screen width | 480 px | Target e-reader display width |
| Screen height | 800 px | Target e-reader display height |
| History days | 7 | How many days of articles to include |
| Mark as read | off | Mark exported articles as read in FreshRSS |

## Requirements

- FreshRSS 1.20+
- PHP 8.1+
- PHP `zip` extension (enabled by default in most PHP builds)
