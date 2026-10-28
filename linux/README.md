# ClipBoardLine for Linux

[Main feature reference](../README.md) · [Türkçe](../README.tr.md) · [Source](https://github.com/orkunisitmak/clipboardline)

This directory contains the native Linux implementation of ClipBoardLine. It brings the full 1:1 macOS/Windows ClipBoardLine experience to Linux desktop environments (KDE Plasma Wayland/X11, GNOME, XFCE, and tiling window managers).

## Highlights for Linux

- **1:1 Native Visual Parity**:
  - Transparent curved hanging shelves floating directly above your desktop surface.
  - Three independent shelves: Images, Texts, and Links.
  - Centered quick search (`Shift+S`) across all visible shelves.
  - Full keyboard navigation (Arrows, Numbers 1–9, `Space` for preview, `Enter` to copy & dismiss, `Ctrl+Enter` to paste into previous app).
  - Floating action palette (`Ctrl+K`).
- **Complete Library & Organization**:
  - Resizable Library window with Grid and List views.
  - Virtual folders and multi-tag hierarchy.
  - Instant pin (`P`), name & pin (`Alt+P`), pin to folder (`Shift+P`), and tags (`Ctrl+Shift+T`).
  - Search across OCR text, notes, titles, and links.
- **Media & Annotation Tools**:
  - Borderless preview modal with zoom, pan, and vector annotations (pen, highlighter, rectangle, ellipse, arrow, line, text).
  - Crop tool with aspect-ratio preservation and non-destructive undo/redo (`Ctrl+Z`).
  - Video support (`.mp4`, `.mov`) with local trimming and poster generation powered by FFmpeg.
- **Screen & Clipboard Integration**:
  - Screen capture (`Ctrl+Alt+A`) supporting native Wayland / X11 via Electron desktopCapturer and KDE Spectacle / Grim fallback.
  - Native Linux clipboard file transfer (`text/uri-list` and GNOME/KDE file copy compatibility).
  - Automatic English & Turkish OCR via local Tesseract.js.
  - Local semantic search powered by ONNX Runtime.

## Requirements

- Node.js 20+ (recommended v22 or v24)
- npm 10+
- FFmpeg (for video previews and trimming)
- Optional: `wtype`, `xdotool`, or `ydotool` for synthetic keypress paste (`Ctrl+Enter`)

## Getting Started

```bash
cd linux
npm install
npm start
```

## Running Tests

All core models, clipboard admission rules, text identity parity, and UI renderers are covered by unit tests:

```bash
npm test
node tests/linux-smoke.cjs
```

## Desktop Packaging

To build a standalone Linux AppImage or tar.gz archive:

```bash
npm run dist
```

Install the desktop launcher for your user:

```bash
cp clipboardline.desktop ~/.local/share/applications/
```
