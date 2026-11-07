# Shared Annotation Engine (Spectacle Parity Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One annotation engine drives both the Alt+Shift+S capture overlay and the Library image editor, adding Spectacle's selection and drawing features (select, redo, number, blur, pixelate, fill/font/shadow/strength styles, keyboard selection, magnifier, double-click accept, right-click reset) and storing captures as re-editable documents.

**Architecture:** New `lib/annotations.cjs` (dual-export IIFE like `lib/shelf-motion.cjs`, global `window.clipboardLineAnnotations`) owns document state, history, hit-testing, tool pointer behaviour and drawing. `renderer.js` keeps only adapters: coordinate mapping, toolbars, keys, modal text entry, commit/save. `main.cjs` + `lib/model.cjs` store captures as original + annotations + rendered PNG.

**Tech Stack:** Electron renderer (plain JS, no build), Canvas 2D, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-shared-annotation-engine-design.md` (repo `clipboardline-repo`).

**Paths:** code is edited in `/home/dokuro/Masaüstü/orkunprogram/clipboardline-linux/` (no git); every task ends by copying changed files to `dist/linux-unpacked/resources/app/` and `../clipboardline-repo/linux/` and committing in `clipboardline-repo` (branch `feat/linux-support`). Test command (run in `clipboardline-linux`): `npm test`.

## Global Constraints

- Existing capture tool keys stay: c crop, b pen, h marker, r rectangle, o ellipse, a arrow, d line, t text. New: v select, n number, u blur, p pixelate. Tool keys ignored while `isEditor(event.target)`.
- Enter and Ctrl+C commit the capture; Esc cancels; commit copies to clipboard and hides (never shows the shelves).
- Double-click commits only while tool ∈ {crop, select, none}; right-click clears only the crop, keeps annotations, is undoable.
- Redo: Ctrl+Shift+Z and Ctrl+Y on both surfaces. History cap 80.
- Shift: line/arrow snap to 45°, rectangle/ellipse square/circle; Shift+arrows move selection 1 px; Alt+arrows resize; Alt+Shift+arrows resize 1 px.
- Blur/pixelate sample only pixels inside the crop (capture) / the image (editor); cache keyed by annotation rect + crop; never recomputed per pointer sample of another annotation.
- Old annotation types (pen, marker, rectangle, ellipse, arrow, line, text) render with the exact same canvas call sequence as today.
- Annotated capture → always a new Library item (no hash reuse); unannotated capture → today's `store.insert` reuse.
- `model.cjs` limits stay: ≤2000 annotations, ≤2 MB JSON, PNG data URL ≤90 MB.
- No test may touch live D-Bus/kglobalaccel/clipboard/systemd; never run `tests/e2e`.

## Review Focus

1. Clipboard echo after the new "clipboard first, store after" commit: the daemon re-broadcasts our own PNG; it must not be imported as a second item → Task 6 test `commit writes clipboard with own fingerprint before insert`.
2. Opening an item saved before this change (annotations of old types, crop set) in the Library editor renders and edits unchanged → Task 2 golden test + Task 3 test `editor opens legacy document unchanged`.
3. Undo after right-click reset restores the previous crop exactly → Task 5 test `right-click reset is undoable`.
4. Number stamps after undo: next number follows the highest remaining stamp, not a stale counter → Task 1 test `undo restores nextNumber`.
5. Blur/pixelate on a crop-edge rect: clipboard PNG equals reopened document render → Task 2 test `blur clamps to clip rect`.

---

### Task 1: Engine core — document, history, hit-test, tools

**Files:**
- Create: `lib/annotations.cjs`
- Create: `tests/annotations.test.cjs`
- Modify: `index.html` (add `<script src="lib/annotations.cjs" defer></script>` before `renderer.js`)
- Modify: `tests/renderer-ui.test.cjs` fixture (run `lib/annotations.cjs` in the vm context before `renderer.js`, as `locales.js` is)

**Interfaces — Produces** (exports of `lib/annotations.cjs`; browser global `clipboardLineAnnotations`):
- `TOOLS = ['none','select','crop','pen','marker','line','arrow','rectangle','ellipse','text','number','blur','pixelate']`
- `DEFAULT_STYLE = {color:'#ff5252', widthPx:7, fill:false, fillColor:'#ff5252', fontFamily:'sans-serif', fontColor:'#ff5252', fontSize:40, shadow:false, strength:50}`
- `createDocument({annotations=[], crop=null}={}) -> Doc` where `Doc = {annotations, crop, selected:null, history:[], redo:[], nextNumber}` (`nextNumber` = 1 + highest existing `number` stamp value, else 1)
- `checkpoint(doc) -> void` (push `{annotations, crop, nextNumber}` clone, cap 80, clear redo)
- `undo(doc) -> boolean`, `redo(doc) -> boolean`
- `annotationBounds(annotation) -> {x,y,width,height}` (moved from renderer `annotationsBounds`, same results)
- `hitTest(doc, point, tolerance=12) -> number` (top-most index or -1)
- `beginTool(doc, tool, point, style, {shift=false}={}) -> Gesture|null` (`null` for `none`, `text` and `crop` — crop stays adapter-owned)
- `updateTool(doc, gesture, point, {shift=false}={}) -> void`
- `endTool(doc, gesture) -> void`
- `addText(doc, point, text, style) -> number` (index)
- `deleteSelected(doc) -> boolean`
- `applyStyle(doc, patch) -> boolean` (changes the selected annotation; returns false if none)
- `setNextNumber(doc, n) -> void`

- [ ] **Step 1: Write failing tests** in `tests/annotations.test.cjs` (`node:test`, `require('../lib/annotations.cjs')`):
  - `rectangle gesture records x,y,width,height` (begin at {10,10}, update {50,30} → width 40, height 20)
  - `shift snaps line to 45 degrees` (begin {0,0}, update {100,90}, shift → width === height)
  - `shift makes rectangle square`
  - `pen collects points`
  - `number stamp increments` (two begins → values 1, 2; `nextNumber` 3)
  - `setNextNumber sets next stamp value` (set 7 → stamp value 7)
  - `undo restores nextNumber` (stamp 1,2, undo → nextNumber 2)
  - `undo/redo round-trip` and `new checkpoint clears redo`
  - `history capped at 80`
  - `select gesture moves annotation` and `resize handle grows rectangle`
  - `hitTest returns top-most`
  - `deleteSelected removes and is undoable`
  - `applyStyle edits selected annotation fillColor`
  - `blur and pixelate are rect gestures with strength from style`
  - `document survives JSON round-trip`
- [ ] **Step 2: Run** `node --test tests/annotations.test.cjs` → FAIL (`Cannot find module '../lib/annotations.cjs'`).
- [ ] **Step 3: Implement** `lib/annotations.cjs` per the interface; port select move/resize and Shift-snap math from today's `editorPointerDown/editorPointerMove` (`renderer.js` ~line 980) so results match.
- [ ] **Step 4: Run** the test file → all pass; `npm test` → 0 fail.
- [ ] **Step 5: Sync + commit** `feat(linux): shared annotation engine core`.

### Task 2: Engine drawing (legacy-identical + new types)

**Files:** Modify `lib/annotations.cjs`; Test `tests/annotations-draw.test.cjs`.

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `drawAnnotations(ctx, annotations, {base=null, clip=null}={}) -> void` (replaces renderer's `drawAnnotations`; `base` = image/canvas source for blur/pixelate; `clip` = `{x,y,width,height}` limiting their sampling).

- [ ] **Step 1: Capture a golden**: before editing, record the canvas call sequence (recording Proxy context) produced by the *current* renderer `drawAnnotations` for one annotation of each legacy type (incl. marker, fill on/off, multi-line text); save as `tests/fixtures/annotations-golden.json`.
- [ ] **Step 2: Write failing tests**: `legacy types draw identical calls to golden`; `number draws filled circle and its value`; `fillColor used for fill, color for stroke`; `fontFamily and fontColor used for text`; `shadow sets shadowBlur>0 only when on`; `pixelate draws from base with cell size from strength`; `blur draws from base with filter from strength`; `blur clamps to clip rect` (rect half outside clip → source rect within clip).
- [ ] **Step 3: Run** → FAIL (`drawAnnotations is not a function`).
- [ ] **Step 4: Implement**; legacy branches copied verbatim; new fields optional so old documents (no `fillColor`) fall back to `color`.
- [ ] **Step 5: Run** test + `npm test` → pass. **Sync + commit** `feat(linux): engine drawing with number, blur and pixelate`.

### Task 3: Library editor on the engine

**Files:** Modify `renderer.js` (editor: `beginImageEdit`, `checkpoint`, `imageUndo`, `editorPointerDown/Move`, `paintEditor`, toolbar at ~line 711, editor key handling); Test `tests/renderer-ui.test.cjs`.

**Interfaces:** Consumes Task 1–2. `ui.editor` gains `doc: Doc` (annotations/crop/history/redo/selected live in `doc`); toolbar adds number, blur, pixelate tools and controls `fill-color`, `font-family`, `font-color`, `shadow`, `strength`, `stamp-number`.

- [ ] **Step 1: Failing tests**: `editor opens legacy document unchanged` (fixture item with old annotations → paint calls equal golden); `editor redo with Ctrl+Shift+Z and Ctrl+Y`; `editor Delete removes selected annotation`; `editor number tool places 1 then 2`; `editor blur tool adds blur annotation`; `editor fill color input edits selected`.
- [ ] **Step 2: Run** `node --test tests/renderer-ui.test.cjs` → new tests FAIL, existing pass.
- [ ] **Step 3: Implement** adapter; delete the replaced renderer logic (no second implementation left).
- [ ] **Step 4: Run** → pass; `npm test` 0 fail. **Sync + commit** `refactor(linux): library editor uses shared annotation engine`.

### Task 4: Capture overlay on the engine (tools, styles, redo)

**Files:** Modify `renderer.js` (capture session init/pointer/draw/undo/toolbar ~lines 503–613, 1060–1075, 1186–1220); Test `tests/renderer-ui.test.cjs`.

**Interfaces:** Consumes Task 1–2. `ui.captureSession` gains `doc: Doc`; crop stays in the adapter but is stored in `doc.crop` so history covers it. Toolbar = Task 3 controls + existing color/zoom/full-screen/save/cancel.

- [ ] **Step 1: Failing tests**: `capture key v selects, n number, u blur, p pixelate`; `capture redo Ctrl+Shift+Z and Ctrl+Y`; `capture shift snaps arrow`; `capture select tool moves annotation`; `capture tool keys ignored in editor field`; keep `capture: Ctrl+C commits…`, `capture: Enter still commits exactly once`.
- [ ] **Step 2: Run** → new tests FAIL.
- [ ] **Step 3: Implement**; remove `captureCheckpoint/captureUndo` duplicates.
- [ ] **Step 4: Run** → pass; `npm test`. **Sync + commit** `feat(linux): capture overlay uses shared engine with new tools`.

### Task 5: Capture selection parity

**Files:** Modify `renderer.js` capture key/pointer handlers + magnifier element in capture view; Test `tests/renderer-ui.test.cjs`.

- [ ] **Step 1: Failing tests**: `arrow keys move crop`; `shift+arrow moves crop 1px`; `alt+arrow resizes crop`; `alt+shift+arrow resizes 1px`; `crop clamps to image bounds`; `double-click with crop tool commits`; `double-click with pen tool does not commit`; `right-click clears crop and keeps annotations`; `right-click reset is undoable`; `shift during crop drag shows magnifier` (magnifier element visible flag in session).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (plain-arrow step = builder's choice, record it in the commit message; magnifier draws a zoomed patch of `session.base` around the pointer, hidden when Shift released).
- [ ] **Step 4: Run** → pass; `npm test`. **Sync + commit** `feat(linux): Spectacle-style keyboard selection, magnifier, double/right click`.

### Task 6: Editable capture persistence

**Files:** Modify `renderer.js` `commitCaptureSession`; `main.cjs` `commitCapture` branch (~line 590); `lib/model.cjs`; Tests `tests/model.test.cjs`, `tests/capture-commit-hides.test.cjs`, `tests/renderer-ui.test.cjs`.

**Interfaces:**
- Renderer sends `command('commitCapture', {dataUrl, originalDataUrl, annotations})` — `dataUrl` rendered PNG (as today), `originalDataUrl` clean cropped base, `annotations` translated by −crop origin; when no annotations, `originalDataUrl` omitted.
- `Store.insertAnnotatedImage(originalPng: Buffer, renderedPng: Buffer, annotations: Array) -> item` in `lib/model.cjs`: always a new item; `imageFile`=original, `renderedFile`=rendered, `annotations` cloned, `crop` null; same validation limits as `saveImage`.

- [ ] **Step 1: Failing tests**: model `insertAnnotatedImage never reuses an existing item`, `insertAnnotatedImage keeps annotations and rendered file`, `insertAnnotatedImage rejects >2000 annotations`; renderer `commit sends original, rendered and offset annotations`; `commit without annotations sends no original`; source test `commit writes clipboard with own fingerprint before insert` and `still hides, never shows` (extend `capture-commit-hides.test.cjs`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: main writes the rendered PNG to the clipboard (setting `ownFingerprint`/`copyMarker` like `writeClipboard`), `await hide()`, then inserts (`insertAnnotatedImage` if annotations, else `store.insert`); on insert failure `notify(...)`.
- [ ] **Step 4: Run** → pass; `npm test`. **Sync + commit** `feat(linux): store captures as editable annotated documents`.

### Task 7: Final verification

- [ ] `npm test` → 0 fail; diff working copy vs `dist/…/app` vs repo `linux/` for every touched file → identical.
- [ ] `systemctl --user restart app-clipboardline@autostart.service` → `active`; `shortcutNames` lists 4 keys.
- [ ] Manual (user): Alt+Shift+S on DP-1 and DP-2 → draw with each tool → Ctrl+C → window hides, clipboard has render, Library item reopens with editable annotations.
