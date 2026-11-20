# Design: Spectacle-Parity Output Actions (Linux, Phase 2 of 5)

**Date:** 2026-11-20 · **Size:** project · **Code lives in:** `clipboardline-linux/` (working copy, no git), synced to
`clipboardline-linux/dist/linux-unpacked/resources/app/` and `clipboardline-repo/linux/` (HANDOVER §7.3).

## 1. Intent

After selecting/annotating a region with Alt+Shift+S, the user wants everything KDE Spectacle 6.8.2 can do with the
result: copy, copy location, save, save as, open with another app, print, share, open containing folder, extract text,
QR code detection, with notifications. The same actions must exist on Library image items (preview toolbar, right-click,
Actions palette), implemented once in a shared output module. The user waived design approval ("do it as you know, I'll
review"); every decision not given by the brief is labelled **my call** below.

Phase 1 (selection & drawing, `lib/annotations.cjs`) is done (`92ef367`). Later phases: 3 capture modes, 4 settings page,
5 screen recording.

## 2. Current state (verified 2026-11-20)

- `main.cjs` commands: `copy` (→ `writeClipboard`, marked writes), `export` (folder picker, `<label>.png`, PNG only),
  `ocr`/`copyOCR` (tesseract.js, fixed `eng`+`tur`, result cached in `item.ocrText`, language files prepared with sync
  fs calls), `openFile` (`shell.openPath` of the internal media file), `revealFile` (`shell.showItemInFolder` of the
  internal media file), `startDrag`, `commitCapture` (clipboard write → hide → store; annotated captures via
  `Store.insertAnnotatedImage`), `cancelCapture`.
- `configureWatchers()` watches `~/Pictures/Screenshots`, `~/Resimler/Ekran Görüntüleri`, `~/Resimler/Screenshots`
  (+ user folders) and **imports every new image**, then `show('shelves')` if `openAfterScreenshot` (default true).
  On this machine `~/Resimler/Ekran Görüntüleri` exists — Spectacle's own default save folder here
  (`XDG_PICTURES_DIR=$HOME/Resimler`, `spectaclerc` `translatedScreenshotsFolder=Ekran Görüntüleri`).
- Capture overlay (`renderer.js` `captureWorkspace`): tools, styles, zoom, undo/redo, Cancel (Esc), "Save to line"
  (Enter / Ctrl+C / double-click = Library + clipboard + close). No output actions.
- Library: preview toolbar (copy, pin, markup, crop, actions), inspector (`Open file`, `Export copies`), Actions palette
  (`Open file`, `Show in folder`, `Copy text from image` Ctrl+Shift+C). No right-click menu on cards.
- Settings: `model.cjs` `DEFAULTS` + strict `settings()` validator (unknown keys rejected).
- System tools present: `zbarimg` 0.23.95, `gio`, `qml6` + `org.kde.purpose` QML module (KDE Purpose), CUPS libs
  (no `lp` CLI), `/usr/share/tessdata` (`eng`, `osd`), bundled `ocr-data/{eng,tur}`. No pure-JS QR decoder in
  `node_modules`. `nativeImage` cannot encode WebP; Chromium canvas can (png/jpeg/webp).

## 3. Goals

One shared output module, two surfaces:

- **O1 Copy image** — unchanged (Enter/Ctrl+C in capture, Copy in Library).
- **O2 Save** (Ctrl+S) to the default folder with the filename template; placeholders `<yyyy> <yy> <MM> <dd> <hh> <mm>
  <ss> <title> <#>`; on collision a numbered suffix; default format png/jpg/webp; quality for lossy formats.
- **O3 Save As…** (Ctrl+Shift+S): native save dialog prefilled with the template name in the default folder; the
  format follows the chosen extension (png/jpg/jpeg/webp), else the default format.
- **O4 Copy Location** — copies the saved file's absolute path; saves to the default location first if the item has
  never been saved (Spectacle behaviour).
- **O5 Open Containing Folder** — of the saved file (saves first if needed); never the internal media path.
- **O6 Open with** — apps registered for `image/png` from the desktop MIME database (`mimeapps.list` defaults/added/
  removed + `mimeinfo.cache`, XDG data dirs), default first; launched through `gio launch <desktop file> <file>`.
- **O7 Print** — system print dialog for the image.
- **O8 Share** — KDE Purpose share sheet when `qml6` and the `org.kde.purpose` QML module exist; hidden otherwise.
- **O9 Extract Text (OCR)** — default languages from settings, plus one entry per installed language
  (bundled `ocr-data` ∪ `/usr/share/tessdata`, excluding `osd`); copies the text; notification "Text copied".
- **O10 QR/barcode detection** — `zbarimg` (async) on the image; "Code found: …" + text copied; binary payloads give
  "Code found with binary content"; none → "No QR code found".
- **O11 Notifications** — after save ("Saved as <file> to <folder>"), copy location, OCR, QR. In-app toast when the
  window is visible; desktop notification (Electron `Notification`) when it is hidden (capture flow). Clicking a
  save notification opens the containing folder.
- **O12 Settings storage** (no UI; phase 4): `settings.output = {saveFolder:'', filenameTemplate:
  'Screenshot_<yyyy><MM><dd>_<hh><mm><ss>', format:'png', quality:90, ocrLanguages:['eng','tur']}`; `saveFolder:''`
  means "resolve the default at run time".

## 4. Non-goals

Settings page for these defaults (phase 4); capture modes/delay (phase 3); recording (phase 5); "quit after save/copy"
and "also copy when saving" preferences (phase 4); app icons in the Open-with list; KDE's free-form "Other
application…" chooser; automatic QR detection while drawing (explicit action instead); fixing phase-1 follow-ups.

## 5. Anti-goals (failure even if it "works")

- The quick capture flow regresses: Alt+Shift+S → drag → Enter/Ctrl+C must stay instant, copy, close, never show
  ClipBoardLine.
- Saving into a watched folder re-imports the file as a second Library item or pops the shelves open.
- Any new synchronous I/O, encoding or child process on the Electron main thread (HANDOVER zero-lag rule): QR, OCR,
  print, open-with discovery, file writes and default-folder resolution are async.
- A renderer can make main write to an arbitrary path (writes only to a path main itself chose in this flow).
- External apps (Open with, Share, Print) receive the Library's internal media file and can modify it.
- Any test touches the live session (D-Bus, kglobalaccel, clipboard, systemd, notifications) or the real home folders.

## 6. Approaches

- **A. One main-side module `lib/output-actions.cjs` + one renderer helper (chosen, my call).** Main owns paths,
  templates, dialogs, saved-path bookkeeping, app discovery, QR, OCR, print, share, notifications. The renderer owns
  only image encoding for jpg/webp (Chromium canvas, async, off the main process) and the shared output menu. The
  capture overlay first stores the capture as a Library item (as Enter does, without the clipboard write), then runs the
  very same item-based action as the Library. One code path for both surfaces.
- B. Encode everything in main with `nativeImage` — rejected: no WebP, synchronous encoding on the main thread.
- C. Separate capture-only actions on the in-memory PNG — rejected: two implementations that drift (phase-1 lesson).

## 7. Decisions (my calls)

1. **Capture actions finish the capture first.** Every output action in the overlay (except Copy, which is the existing
   commit) commits the capture to the Library *without* touching the clipboard (`commitCapture {copy:false}`), hides
   the overlay, then runs on the stored item. Spectacle's region overlay also closes on accept; dialogs (Save As,
   Print, Share) would otherwise sit under a full-screen always-on-top overlay.
2. **Save does not copy the image** (no clipboard write); "also copy" is a phase-4 preference.
3. **Default folder** = `XDG_PICTURES_DIR` (from `~/.config/user-dirs.dirs`, else `~/Pictures`) + Spectacle's
   `translatedScreenshotsFolder` from `~/.config/spectaclerc` if present, else `Screenshots` → here
   `~/Resimler/Ekran Görüntüleri`, i.e. the same folder Spectacle uses. Created on first save (`mkdir -p`, async).
4. **Watcher suppression.** The output module remembers every file it writes (absolute path, 30 s); the folder watcher
   skips those files. No duplicate item, no shelves pop-up.
5. **Saved path on the item.** `item.savedPath` (last file written for that item) is stored by a main-only Store method
   `setSavedPath(id, file)` (not renderer-callable) and exposed in `publicState`. Copy Location / Open Containing
   Folder use it if the file still exists, else save first.
6. **Template details.** `<hh>` is 24-hour (Qt `hh`, Spectacle). `<title>` = item name or title, else empty; after
   substitution, characters `<>:"/\|?*` and control chars become `-`, leading/trailing ` ._-` are trimmed, empty →
   `Screenshot`. `<#>` = the smallest n ≥ 1 that makes the name free; without `<#>` a collision appends `-2`, `-3`, …
   (same style as today's Export). Max 200 characters before the extension.
7. **Write authorization.** `outputPlan` returns a one-time token bound to `{id, path, format}`; `outputWrite` accepts
   only that token (expires after 2 minutes). Files are written with flag `wx` (never overwrite) except a Save As path
   the user confirmed in the dialog.
8. **Encoding.** PNG: main copies the item's rendered media file (`fs.promises.copyFile`). JPEG/WebP: the renderer
   fetches the item's `mediaUrl`, draws it to an `OffscreenCanvas` (white background for JPEG), `convertToBlob` with
   `quality/100`, sends a data URL; main validates the magic bytes for the planned format and writes it.
9. **Temp copies for external apps.** Open with / Share / Print use the saved file if present, else a private temp copy
   under `$XDG_RUNTIME_DIR/clipboardline-output/` (fallback `os.tmpdir()`), named by the template, mode 0600, removed
   on quit and when older than 1 hour. External apps never get the media-store path.
10. **Open with.** List = default app (`mimeapps.list [Default Applications] image/png`), then `[Added Associations]`,
    then `mimeinfo.cache` entries, minus `[Removed Associations]`, minus `Hidden=true`/`NoDisplay=true`/missing
    files; search order `$XDG_CONFIG_HOME` (`mimeapps.list`, `kde-mimeapps.list`), `$XDG_DATA_HOME/applications`,
    `$XDG_DATA_DIRS/*/applications`. Names use `Name[tr]` when the UI language is Turkish. Cached for 60 s.
    Launch: `gio launch <abs .desktop> <file>`, detached, `stdio:'ignore'`, unref.
11. **Print.** A hidden, sandboxed `BrowserWindow` loads a temp HTML page that shows the image fitted to the page and
    calls `webContents.print({silent:false})` (system GTK/CUPS dialog); the window is destroyed in the callback.
12. **Share.** `qml6 <assets/share.qml> -- <file>`: a small window with `Purpose.AlternativesView`
    (`pluginType:"Export"`, `mimeType:"image/png"`, `urls:[file]`), quits when the job finishes or is cancelled.
    Availability = `qml6` on PATH and `/usr/lib/qt6/qml/org/kde/purpose/qmldir` (or another `QML_IMPORT_PATH`) exists.
13. **QR.** `zbarimg --xml -q --nodbus -Sqrcode.binary <file>` (not `-Sbinary`: the global form loses the XML output; see commit 1d39fdf) (async `execFile`, 10 s timeout); parse `<symbol type=…>`
    and `<data>` (CDATA text, or `format="base64"`). Exit code 4 = nothing found. Text is "binary" if it is not valid
    UTF-8 or contains control characters other than tab/CR/LF. The first text symbol's data is copied; if several are
    found the notification says how many. Hidden when `zbarimg` is missing.
14. **OCR.** `recognize` gains a languages argument; the background index keeps `eng+tur` and the `item.ocrText`
    cache; Extract Text with other languages re-runs recognition and does not overwrite the cache. Language files are
    prepared with async fs (system tessdata gzip-copied once into the existing `ocr-models` cache with `zlib`).
15. **Keys.** Capture overlay: Ctrl+S Save, Ctrl+Shift+S Save As, Ctrl+Shift+C Copy Location (Spectacle), Ctrl+P
    Print, Ctrl+E output menu. Library (shelves/library/image preview, not while marking up): new local shortcuts
    `saveImageFile` Ctrl+S, `saveImageFileAs` Ctrl+Shift+S, `outputMenu` Ctrl+E (rebindable in Keyboard shortcuts).
    Library Ctrl+Shift+C stays Copy text from image (existing binding), so Copy Location has no Library default key.
16. **Menu.** One renderer component, `outputMenu`: a popup list with Save, Save As…, Copy Location, Open Containing
    Folder, Open with (one row per app), Print, Share (if available), Extract Text, Extract Text · <language> (one per
    installed language), Scan QR code (if available). Opened by: the capture toolbar "Export" button / Ctrl+E; the
    image preview toolbar "Export" button / Ctrl+E; right-click on an image card (shelves and Library). Arrow keys,
    Enter, Esc. The Actions palette (Ctrl+K) lists the same actions.
17. **Existing actions.** `revealFile` ("Show in folder") now prefers `savedPath` and falls back to the old behaviour;
    `openFile` and `export` are unchanged.
18. **Strings.** Every new UI/notification string has a Turkish entry in the `TR` map in `renderer.js`; main-side
    desktop notifications are translated with the same strings through a small `outputText(language, key)` table in
    the output module (TR + EN), since `locales.js` lives in the renderer.

## 8. Constraints

- Plain JS, no build; main-side module is CommonJS in `lib/`; renderer code stays in `renderer.js`.
- `command()` payload ≤ 92 MB JSON; data URLs ≤ 90 MB; images ≤ 80 MP.
- Sandbox/contextIsolation unchanged; no new preload API (everything goes through `command`).
- Tests (`npm test`): temp directories for stores, XDG dirs and fake tools; PATH isolated as in
  `tests/global-shortcuts-kde-timeout.test.cjs`; no Electron, D-Bus, clipboard, notifications, `systemctl`,
  `tests/e2e`, `tests/linux-smoke.cjs`. Electron-only pieces (dialog, Notification, BrowserWindow, shell, clipboard)
  are injected into the module so it is testable with fakes.
- Sync routine after each task; the service is restarted only at the very end.

## 9. Verification

- Unit tests for the module: template expansion (every placeholder, `<#>`, collision suffix, sanitising, length),
  default-folder resolution (user-dirs, spectaclerc, fallbacks), write-token rules (wrong id/token/expired/format magic),
  saved-path reuse and re-save when the file is gone, watcher suppression, MIME app discovery (defaults, added, removed,
  hidden, NoDisplay, Turkish names), `gio launch` argv, zbarimg XML parsing (text, base64 binary, none, missing tool),
  OCR language discovery, notification routing (toast vs desktop), temp-copy cleanup.
- Model tests: `output` settings defaults/validation; `setSavedPath` + `publicState`.
- Renderer fixture tests: capture toolbar buttons/keys (Ctrl+S → `commitCapture{copy:false}` then `outputPlan`),
  Enter/Ctrl+C commit payload unchanged, output menu on both surfaces, right-click on an image card, Actions palette
  entries, JPEG/WebP encode path calls `outputWrite` with the plan token, Turkish strings present.
- Full `npm test` green; three copies in sync; service restarted; `shortcutNames` lists 4 shortcuts; journal clean.
- Manual (user): Save/Save As/Copy Location/Open with/Print/Share/OCR/QR from the overlay and from the Library on both
  monitors; saved file does not create a duplicate Library item.
