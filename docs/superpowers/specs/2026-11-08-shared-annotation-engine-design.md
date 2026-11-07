# Design: Shared Annotation Engine + Spectacle-Parity Selection & Drawing (Linux, Phase 1)

**Date:** 2026-11-08 · **Size:** project · **Code lives in:** `clipboardline-linux/` (working copy), synced to `clipboardline-repo/linux/` and `dist/linux-unpacked/resources/app/` per HANDOVER §7.3.

## 1. Intent

The user presses Alt+Shift+S in ClipBoardLine and wants everything KDE Spectacle 6.8.2 offers in its
region-selection + annotation screen (Spectacle is what Meta+Shift+S launches on this machine).
Spectacle's full feature list was extracted from its installed handbook and its 411 UI strings
(`/usr/share/locale/tr/LC_MESSAGES/spectacle.mo`); it was not observed live.

The user chose: the new drawing tools must exist **both** in the capture overlay (Alt+Shift+S) and
in the Library image editor, built on **one shared annotation engine** (approach A below).

This is phase 1 of 5. Later phases (not here): output actions (save/save-as/OCR/QR/export/print),
capture modes (window/monitor/delay/pointer), settings page, screen recording.

## 2. Current state (what exists today)

- **Capture overlay** (`renderer.js`: `initCaptureSession`, `capturePointerDown/Move`, `drawCaptureCanvas`,
  `captureCheckpoint/captureUndo`, `commitCaptureSession`): crop selection with edge/corner resize and
  move-inside (`cropEdges`, `resizedCrop`), size badge (`capture-size-badge`), tools
  crop/pen/marker/rectangle/ellipse/arrow/line/text (keys c,b,h,r,o,a,d,t), color input, Undo (Ctrl+Z),
  zoom (Ctrl +/-/0), pan (Space), Enter or Ctrl+C commits, Esc cancels. Commit flattens annotations
  into one PNG (`main.cjs` `commitCapture` → `store.insert('image', png)`); annotations are lost.
- **Library image editor** (`ui.editor`, `editorPointerDown/Move`, `paintEditor`, `checkpoint`):
  tools select/pen/marker/rectangle/ellipse/arrow/line/text/crop, color, stroke width (`ink-width`),
  fill (`ink-fill`), text size (`text-size`), Undo/Redo, Shift-snap (45° lines, square/circle shapes),
  select → move/resize/recolor. Saves non-destructively: `model.cjs` `saveImage` keeps the original,
  `annotations[]`, `crop` and a rendered PNG (validation only bounds count/size, not types).
- **Shared already:** `drawAnnotations(context, annotations)`, `annotationsBounds`, `within`, `cropEdges`,
  `resizedCrop`. Pointer/tool/history logic is duplicated and has drifted.
- **Module pattern:** `lib/*.cjs` IIFE exporting to `module.exports` (Node tests) or a `window` global
  (browser), loaded by `index.html` before `renderer.js` (see `lib/shelf-motion.cjs`).
- **Tests:** `npm test` = `node --test tests/*.test.cjs` (375 pass / 1 skip today);
  `tests/renderer-ui.test.cjs` runs the real renderer in a vm DOM fixture (`f.api.surface`, `f.key`,
  `f.commands`; canvases `markup-canvas`, `capture-canvas`).

## 3. Goals

**Engine (`lib/annotations.cjs`, used by both surfaces):**
- G1 Tool registry + per-tool pointer behaviour (begin/update/end) for: none (pan), select, crop,
  freehand(pen), highlighter(marker), line, arrow, rectangle, ellipse, text, **number stamp**,
  **blur**, **pixelate**.
- G2 Document state: `annotations[]`, `selected`, undo/**redo** history, next stamp number.
- G3 Select tool on both surfaces: hit-test top-most, move, resize (bottom-right handle), Delete/Backspace
  removes, changing color/width/fill/font while selected edits that annotation.
- G4 Shift modifier on both surfaces: lines/arrows snap to 45°, rectangles/ellipses become square/circle
  (Spectacle tooltips: "Shift: Snap to 45 degree increments", "Shift: Snap to straight lines").
- G5 Style properties on both surfaces: stroke color, stroke width, fill on/off + **fill color**
  (separate from stroke), **font family**, **font color**, font size, **shadow** on/off,
  **effect strength** (blur/pixelate), **number** (next stamp value).
- G6 Rendering: one `draw(context, annotations, {base})`; blur and pixelate read pixels from the base
  image under their rectangle and are non-destructive (re-rendered from the original).
- G7 Number stamp: click places a filled circle with the next integer; numbers auto-increment;
  the Number control sets the next value.

**Capture overlay only (selection, Spectacle region selector parity):**
- S1 Keep existing new/move/resize-by-handle selection and size badge.
- S2 Keyboard: arrows move selection; Shift+arrows move 1 px; Alt+arrows resize; Alt+Shift+arrows
  resize 1 px. (Plain-arrow step is the builder's call.)
- S3 Holding Shift while creating/resizing the selection shows a magnifier near the cursor.
- S4 Double-click inside the selection = commit (same as Enter/Ctrl+C).
- S5 Right-click = reset (clear) the selection; Esc still cancels the whole capture.
- S6 Redo in capture: Ctrl+Shift+Z and Ctrl+Y.

**Persistence:**
- P1 A committed capture is stored as an editable image document: original = the **cropped** base
  without annotations; `annotations` translated by −crop origin; rendered PNG = what is copied to the
  clipboard. Opening it in the Library editor shows the annotations as editable objects.

## 4. Non-goals (later phases)

Accept-on-click-and-release, light background mask, remember-selected-area (settings, phase 4);
save/save-as/copy-location/OCR/QR/export/print/share (phase 2); window/monitor/delay/pointer capture
modes (phase 3); recording (phase 5). Visually cloning Spectacle's look: UI follows ClipBoardLine's
existing glass toolbar style.

## 5. Anti-goals (failure even if it "works")

- The quick flow regresses: Alt+Shift+S → drag → Enter/Ctrl+C must stay instant, copy to clipboard,
  close, and not bring ClipBoardLine to front (current behaviour as of 2026-11-08).
- Any frame stutter while drawing or dragging on a 2560×1440 capture (HANDOVER §2.1 zero-lag rule).
  Blur/pixelate must not recompute the whole image on every pointer move.
- Existing saved Library edits render differently or fail to open (old annotation types must render
  pixel-identically).
- Two drifting implementations remain after the refactor.

## 6. Approaches

- **A. Shared engine module (chosen by the user).** Move tool/pointer/history/selection logic into
  `lib/annotations.cjs`; capture overlay and Library editor become thin adapters (coordinate mapping,
  DOM toolbar, commit/save). New tools are written once. Cost: migrating two code paths first, proven
  by tests that today's tools behave the same.
- B. Draw only in the Library editor: capture selects a region, annotation happens after in the
  editor. Least code, but adds a step and breaks "select → draw → Ctrl+C". Rejected by the user.
- C. Add features to both surfaces separately. Rejected: double work, guaranteed drift.

## 7. Constraints

- No build step: renderer code is plain browser JS loaded by `index.html`; the engine must follow the
  `lib/shelf-motion.cjs` dual-export IIFE pattern and be added to `index.html` before `renderer.js`,
  and to the `renderer-ui.test.cjs` vm fixture.
- `model.cjs` `saveImage` limits: ≤2000 annotations, ≤2 MB JSON, PNG data URL ≤90 MB; annotation
  objects must stay JSON-serialisable.
- Electron renderer only (no Node APIs in the engine).
- Keep existing capture tool keys (c,b,h,r,o,a,d,t). New keys (my call): v select, n number, u blur,
  p pixelate. Ignore tool keys while an editor field has focus (existing `isEditor` guard).
- Follow HANDOVER sync routine: working copy → `dist/linux-unpacked/resources/app/` → repo, restart
  `app-clipboardline@autostart.service`.

## 8. Calls I made (not decided by the user)

- P1 stores the cropped image as the original (not the full multi-monitor screenshot) to keep
  storage small; annotations outside the crop are clipped.
- New tool keys v/n/u/p.
- Blur/pixelate are rectangle tools; default strength chosen by the builder.
- Toolbar layout follows ClipBoardLine's style, not Spectacle's.
- **Dedup (builder check Q1):** `store.insert` reuses an item whose image hash matches. With P1 the
  hash is the clean crop, so a capture **with annotations always becomes a new item** (separate insert
  path that skips the hash match); a capture with no annotations keeps today's reuse. Never overwrite
  another item's annotations.
- **Commit latency (Q2):** the user-visible part of Enter/Ctrl+C is: clipboard written + window hidden.
  Write the rendered PNG to the clipboard and hide first; store the editable document (clean crop +
  annotations + rendered PNG) right after in `main.cjs`. If that save fails, toast/notify and keep the
  clipboard copy (the image is not lost to the user). Today's single-PNG path is the budget to beat.
- **Pointer scope (Q3):** double-click commits only while the crop, select or none tool is active (a
  double-click with pen/marker/stamp is drawing). Right-click clears only the crop selection, keeps
  the annotations, and is an undoable step; Esc still cancels the whole capture.
- **Blur/pixelate sampling (Q4):** in the capture overlay, blur/pixelate sample only pixels inside the
  crop, so the clipboard PNG and the reopened Library document render identically. Their cache key
  includes the crop rectangle; recompute on crop change (debounced to the next frame), never per
  pointer sample of an unrelated annotation.

## 9. Left to the builder

Engine API shape and file split; how blur/pixelate cache their rendered region; magnifier size/zoom;
default stamp style; plain-arrow selection step; which fonts the font picker lists (system fonts via
`document.fonts`/`queryLocalFonts` are acceptable, a short fixed list is acceptable).

## 10. Verification

- Unit tests for `lib/annotations.cjs` (`node:test`): every tool's begin/update/end, Shift snapping,
  undo/redo, select/move/resize/delete, number auto-increment, blur/pixelate geometry, JSON round-trip.
- Renderer fixture tests on both surfaces: tool keys, redo, double-click commit, right-click reset,
  arrow/Alt/Shift selection keys, Ctrl+C/Enter commit unchanged, editor field guard.
- Regression: old annotation documents render identically (fixture with saved annotations).
- Full `npm test` green; both copies synced; manual check of the quick flow on DP-1 and DP-2.
