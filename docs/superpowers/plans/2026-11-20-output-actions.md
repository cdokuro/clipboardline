# Output Actions (Spectacle Parity Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spectacle's output actions (save, save as, copy location, open containing folder, open with, print, share, extract text, QR detection, notifications) on both the Alt+Shift+S capture overlay and Library image items, through one shared module.

**Architecture:** `lib/output-actions.cjs` (main process, CommonJS, Electron pieces injected) owns templates, paths, write tokens, saved-path bookkeeping, temp copies, notifications and every action; `lib/desktop-integration.cjs` is its adapter to system tools (MIME apps, `gio`, `zbarimg`, tessdata, KDE Purpose). `main.cjs` exposes four commands. In `renderer.js` one function `runOutput(action, id, options)` and one popup `outputMenu` serve both surfaces; the capture overlay first commits the capture as a Library item (`copy:false`) and then calls the same function.

**Tech Stack:** Electron 44 / Node 24, plain browser JS (no build), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-output-actions-design.md` (repo `clipboardline-repo`). Read §7 "Decisions" before any task.

**Paths:** code is edited in `/home/dokuro/Masaüstü/orkunprogram/clipboardline-linux/` (no git). Every task ends with the sync: copy changed non-test files to `clipboardline-linux/dist/linux-unpacked/resources/app/<same path>`, copy every changed file (tests too) to `/home/dokuro/Masaüstü/orkunprogram/clipboardline-repo/linux/<same path>`, commit in `clipboardline-repo` (branch `feat/linux-support`) with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Do not restart the service. Test command (in `clipboardline-linux`): `npm test` (baseline 458 tests, 457 pass, 1 skipped).

## Global Constraints

- Settings shape: `settings.output = {saveFolder:'', filenameTemplate:'Screenshot_<yyyy><MM><dd>_<hh><mm><ss>', format:'png', quality:90, ocrLanguages:['eng','tur']}`; formats exactly `png|jpg|webp`; quality integer 1–100; `saveFolder` `''` or an absolute path ≤ 4096 chars.
- Placeholders exactly `<yyyy> <yy> <MM> <dd> <hh> <mm> <ss> <title> <#>`; `<hh>` is 24-hour; all zero-padded to 2 digits except `<yyyy>` and `<#>`.
- No new synchronous fs, encoding or child process on the main thread; use `fs.promises`, async `execFile`/`spawn`.
- External apps get the saved file or a temp copy under `$XDG_RUNTIME_DIR/clipboardline-output/` (fallback `os.tmpdir()/clipboardline-output-<uid>`), never `store.mediaPath()`.
- main writes only to a path it planned (one-time token, 2-minute expiry); never overwrites except a Save As path confirmed in the dialog.
- Every new UI string has a Turkish entry in the `TR` map at the top of `renderer.js` (`Object.assign(TR,{...})` line); main-side notification text goes through `outputText(language,key,...values)`.
- Capture quick flow unchanged: Enter / Ctrl+C / double-click → `commitCapture` payload exactly as today (no `copy` key) → clipboard, hide, store.
- Tests never touch the live session: no Electron, D-Bus, clipboard, notifications, `systemctl`, `busctl`, `qdbus`, `wl-copy`, `wl-paste`, `xclip`, `tests/e2e`, `tests/linux-smoke.cjs`, real `$HOME`. Tool-spawning code is tested with temp dirs, injected `execFile`/`spawn`, or fake executables on an isolated `PATH` (pattern: `tests/global-shortcuts-kde-timeout.test.cjs`).

## Review Focus

1. A file saved into a watched folder (`~/Resimler/Ekran Görüntüleri` is watched) must not be re-imported or open the shelves → Task 2 test `ownsFile recognises written files by resolved path`, Task 4 watcher hook.
2. `<title>` from an item named `Rapor/Ağustos: şema?` keeps Turkish letters and replaces only forbidden characters → Task 2 test `template sanitises forbidden characters but keeps unicode`.
3. The default folder (with spaces and non-ASCII, e.g. `Ekran Görüntüleri`) does not exist yet → created on first save → Task 2 test `write creates a missing unicode folder`.
4. Save As with `shot.JPEG` or with no extension → format jpg / default format with its extension appended → Task 2 test `saveAs derives format from the chosen extension`.
5. Esc while the output menu is open in the capture overlay closes only the menu, not the capture → Task 6 test `Escape closes the output menu before cancelling the capture`.

---

### Task 1: Model — output settings and saved path

**Files:**
- Modify: `lib/model.cjs` (`DEFAULTS`, `settings()`, `newItem()`, `Store`)
- Test: `tests/model.test.cjs` (append)

**Interfaces — Produces:**
- `DEFAULTS.output` = the Global Constraints object.
- `settings({output:{...partial}})` merges per key and validates (fail `'Invalid output preference'`); unknown output keys fail; `ocrLanguages` = array of 1–16 strings matching `/^[a-z]{3}(_[a-z]+)?$/`, deduplicated.
- `newItem()` gains `savedPath:''`.
- `Store#setSavedPath(id, file)`: `file` absolute string ≤ 4096 chars, no `\0`; sets `item.savedPath`, does not change `updatedAt`, persists. Not added to `main.cjs` `modelActions`.
- `publicState()` items include `savedPath` (already, via the item clone; verify).

- [ ] **Step 1: Write the failing tests** — `output settings default and validate`: `new Store(dir).data.settings.output` deep-equals the constraint object; `settings({output:{format:'webp',quality:75}})` keeps the other defaults; `format:'gif'`, `quality:0`, `quality:101`, `quality:1.5`, `saveFolder:'relative'`, `ocrLanguages:[]`, `filenameTemplate:''`, `filenameTemplate` of 301 chars, `output:{bogus:1}` each throw. A library JSON written without `output` loads with the defaults. `setSavedPath persists and is public`: after `setSavedPath(id,'/tmp/x.png')` a reopened Store has it, `publicState().items[0].savedPath==='/tmp/x.png'`, `updatedAt` unchanged; `setSavedPath(id,'rel.png')` throws.
- [ ] **Step 2:** `node --test tests/model.test.cjs` → the new tests FAIL.
- [ ] **Step 3:** Implement in `lib/model.cjs` (template ≤ 300 chars, no `\0`/newlines).
- [ ] **Step 4:** `npm test` → all pass (459+).
- [ ] **Step 5:** Sync and commit `feat(linux): output settings and saved path in the model`.

### Task 2: Output core — templates, folders, plan/write, saved files, notifications

**Files:**
- Create: `lib/output-actions.cjs`
- Test: `tests/output-actions.test.cjs`

**Interfaces — Consumes:** Task 1 (`settings.output`, `store.setSavedPath`, `item.savedPath`, `store.item(id)`, `store.mediaPath(id)`).

**Interfaces — Produces (exports of `lib/output-actions.cjs`):**
- `FORMATS = {png:{extension:'.png',mime:'image/png'}, jpg:{extension:'.jpg',mime:'image/jpeg'}, webp:{extension:'.webp',mime:'image/webp'}}`
- `formatFromExtension(ext) -> 'png'|'jpg'|'webp'|null` (case-insensitive; `.jpeg` → `jpg`)
- `matchesFormat(buffer, format) -> boolean` (PNG `89504e470d0a1a0a`, JPEG `ffd8ff`, WebP `RIFF....WEBP`)
- `fileBaseName(template, date, {title='', number=1}) -> string` — substitute, then replace `[<>:"/\\|?*\x00-\x1F]` with `-`, trim leading/trailing `[ ._-]`, cut to 200, empty → `'Screenshot'`.
- `async uniqueOutputPath(folder, template, date, {title, extension, exists}) -> string` — with `<#>`: n = 1, 2, … first free; without: `base`, `base-2`, `base-3`, …; `exists(path) -> Promise<boolean>` defaults to `fs.promises.access`; give up after 10000 → throw `'A free filename could not be found'`.
- `async defaultSaveFolder({home, configHome, readFile}) -> string` — `XDG_PICTURES_DIR` from `<configHome>/user-dirs.dirs` (`$HOME` expanded, quotes removed), else `<home>/Pictures`; subfolder = `translatedScreenshotsFolder` from `<configHome>/spectaclerc` `[ImageSave]` if present, else `Screenshots`.
- `outputText(language, key, ...values) -> string` — keys and EN/TR text:
  `saved` "Saved as %1 to %2" / "%1 olarak %2 klasörüne kaydedildi"; `locationCopied` "File location copied" / "Dosya konumu kopyalandı"; `textCopied` "Text copied" / "Metin kopyalandı"; `noText` "No text found" / "Metin bulunamadı"; `codeFound` "Code found: %1 (copied)" / "Kod bulundu: %1 (kopyalandı)"; `codesFound` "%1 codes found; first copied: %2" / "%1 kod bulundu; ilki kopyalandı: %2"; `codeBinary` "Code found with binary content" / "İkili içerikli kod bulundu"; `noCode` "No QR code or barcode found" / "QR kod veya barkod bulunamadı"; `saveFailed` "The image could not be saved: %1" / "Görsel kaydedilemedi: %1". Language `'tr'` or `'system'` with a `tr*` system locale → TR, else EN (the caller passes the resolved code).
- `class OutputActions` — `constructor({store, settings, fs=require('node:fs').promises, now=()=>new Date(), home, configHome, runtimeDir, language=()=> 'en', dialog, writeText, reveal, notify, integration=null, print=null, ocr=null})` where `dialog.showSaveDialog(options) -> Promise<{canceled, filePath}>`, `writeText(text) -> Promise`, `reveal(file)`, `notify(text, {file}={})`.
  - `async plan(id, mode) -> {token, path, format, quality}|{canceled:true}` — `mode` `'save'`: `uniqueOutputPath(saveFolder||defaultSaveFolder(), …)`; `'saveAs'`: dialog with `defaultPath` = that path and filters PNG/JPEG/WebP; chosen extension → format, no/unknown extension → default format and its extension appended. Throws for a non-image or recording item.
  - `async write(token, dataUrl=null) -> {path}` — token must exist, unexpired, single use. `png` → `fs.copyFile(store.mediaPath(id), path, COPYFILE_EXCL unless confirmed)`; other formats → `dataUrl` required, `data:<mime>;base64,` prefix of the planned format, decoded bytes pass `matchesFormat`, write with flag `wx` (or `w` if confirmed). `mkdir -p` the folder first. Then `ownFile(path)`, `store.setSavedPath(id, path)`, `notify(outputText(lang,'saved',basename,dirname),{file:path})`.
  - `ownsFile(file) -> boolean` — true for 30 s after this instance wrote `path.resolve(file)`.
  - `async savedFile(id) -> string|null` — `item.savedPath` if it still exists as a regular file.
  - `async copyLocation(id) -> {path}|{needsSave:true}` — writes the path via `writeText`, notifies `locationCopied`.
  - `async revealSaved(id) -> {path}|{needsSave:true}` — `reveal(path)`.
  - `async externalFile(id) -> string` — saved file, else a temp copy (`fileBaseName` + `.png`, mode 0600) in the temp dir; deletes temp files older than 1 h each call.
  - `async cleanup()` — removes the temp dir.

- [ ] **Step 1: Write the failing tests** (temp dirs only; fake `dialog`, `writeText`, `reveal`, `notify`; a real temp `Store` with one PNG item from `tests/fixtures` or a generated 1×1 PNG buffer):
  - `template expands every placeholder` — date `2026-11-20T09:05:07` local, template `<yyyy>-<yy>-<MM>-<dd>_<hh><mm><ss>_<title>_<#>`, title `T`, number 3 → `2026-26-11-20_090507_T_3`; hour 21 → `21`.
  - `template sanitises forbidden characters but keeps unicode` — title `Rapor/Ağustos: şema?`, template `<title>` → `Rapor-Ağustos- şema-`→trimmed `Rapor-Ağustos- şema`; empty title with template `<title>` → `Screenshot`; 300-char result cut to 200.
  - `unique path numbers collisions` — existing `S.png` → `S-2.png`, then `S-3.png`; template `S_<#>` with `S_1.png` existing → `S_2.png`.
  - `default folder follows user-dirs and spectaclerc` — user-dirs `XDG_PICTURES_DIR="$HOME/Resimler"` + spectaclerc `translatedScreenshotsFolder=Ekran Görüntüleri` → `<home>/Resimler/Ekran Görüntüleri`; neither file → `<home>/Pictures/Screenshots`.
  - `save writes a PNG copy and records it` — `plan(id,'save')` then `write(token)` → file bytes equal media, `item.savedPath` set, `notify` called once with `/Saved as .* to /` and `{file}`; second `write(token)` throws.
  - `write creates a missing unicode folder` — `saveFolder` = `<tmp>/a b/Ekran Görüntüleri` (absent) → written.
  - `write rejects bad tokens and mismatched bytes` — unknown token, expired token (`now` advanced 121 s), jpg plan with a PNG data URL, jpg plan with no data URL → each throws, nothing written.
  - `saveAs derives format from the chosen extension` — dialog returns `shot.JPEG` → `format:'jpg'`; `shot` → `shot.png` with `format:'png'`; `canceled:true` → `{canceled:true}`; confirmed existing path is overwritten.
  - `ownsFile recognises written files by resolved path` — true for `path.join(folder,'.','name.png')`, false for another file, false after 31 s.
  - `copyLocation needs a save until a file exists` — `{needsSave:true}` before save and after the saved file is deleted; after save copies the exact path and notifies `File location copied`.
  - `externalFile never returns the media path` — no save → path inside the temp dir with mode 0600 and equal bytes; after save → `savedPath`; a temp file with mtime 2 h ago is removed.
  - `outputText resolves Turkish` — `outputText('tr','textCopied')==='Metin kopyalandı'`, `outputText('en','saved','a.png','/x')==='Saved as a.png to /x'`.
- [ ] **Step 2:** `node --test tests/output-actions.test.cjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `lib/output-actions.cjs` with the interfaces above.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Sync and commit `feat(linux): shared output actions core (save, save as, location, notifications)`.

### Task 3: Desktop integration adapters

**Files:**
- Create: `lib/desktop-integration.cjs`
- Test: `tests/desktop-integration.test.cjs`

**Interfaces — Produces:**
- `async imageApps({env, home, language='en', fs=require('node:fs').promises, mime='image/png'}) -> [{id, name, file}]` — spec §7.10 order and filters; `id` = desktop file id (`org.kde.gwenview.desktop`); `name` = `Name[tr]` when `language==='tr'`, else `Name`; dedup by id; config dirs `$XDG_CONFIG_HOME||<home>/.config` + `$XDG_CONFIG_DIRS||/etc/xdg`, data dirs `$XDG_DATA_HOME||<home>/.local/share` + `$XDG_DATA_DIRS||/usr/local/share:/usr/share`.
- `launchCommand(desktopFile, file) -> {command:'gio', args:['launch', desktopFile, file]}`
- `parseZbarXml(xml) -> [{type, text, binary}]` — `text` is the decoded string (CDATA, or base64 decoded as UTF-8) or `null` when binary.
- `async scanCodes(file, {execFile=require('node:child_process').execFile, env=process.env}={}) -> {available, codes}` — runs `zbarimg --xml -q --nodbus -Sbinary <file>`, timeout 10000, maxBuffer 4 MB; `ENOENT` → `{available:false,codes:[]}`; exit code 4 → `{available:true,codes:[]}`.
- `async toolAvailable(name, env=process.env) -> boolean` — searches `env.PATH` with `fs.promises.access(X_OK)`.
- `async shareAvailable({env=process.env, fs}={}) -> boolean` — `qml6` on PATH and `org/kde/purpose/qmldir` in `$QML_IMPORT_PATH` dirs or `/usr/lib/qt6/qml`.
- `async ocrLanguages({bundledDir, systemDirs=['/usr/share/tessdata'], fs}) -> [{code, name:{en,tr}, source:'bundled'|'system', file}]` — bundled layout `<bundledDir>/<code>/4.0.0_best_int/<code>.traineddata.gz`; system `<dir>/<code>.traineddata`; skip `osd` and `equ`; bundled wins on duplicates; sorted by code. Names table at least `eng English/İngilizce`, `tur Turkish/Türkçe`, `deu German/Almanca`, `fra French/Fransızca`, `spa Spanish/İspanyolca`, `aze Azerbaijani/Azerbaycanca`; unknown → code.

- [ ] **Step 1: Write the failing tests** (temp XDG trees; fake `execFile`; for `toolAvailable`/`shareAvailable` an isolated `PATH` dir with a fake executable):
  - `imageApps orders default, added, cache and drops removed/hidden` — mimeapps `[Default Applications] image/png=b.desktop`, `[Added Associations] image/png=c.desktop;`, `[Removed Associations] image/png=d.desktop`, cache `image/png=a.desktop;d.desktop;e.desktop;`, `e.desktop` has `NoDisplay=true` → ids `['b.desktop','c.desktop','a.desktop']`; missing desktop files skipped; `language:'tr'` uses `Name[tr]`.
  - `launchCommand passes the file as one argument` — file `/x/a b.png` → args `['launch','/apps/b.desktop','/x/a b.png']`.
  - `parseZbarXml reads text and binary symbols` — XML with `<symbol type='QR-Code' quality='1'><data><![CDATA[https://example.com]]></data></symbol>` and `<symbol type='QR-Code'><data format='base64' length='3'><![CDATA[/w==]]></data></symbol>` → `[{type:'QR-Code',text:'https://example.com',binary:false},{type:'QR-Code',text:null,binary:true}]`; base64 of `Merhaba ş` → text `Merhaba ş`.
  - `scanCodes maps exit codes` — fake execFile error `{code:'ENOENT'}` → `available:false`; `{code:4}` → `codes:[]`; success → parsed; argv equals `['--xml','-q','--nodbus','-Sbinary',file]`.
  - `ocrLanguages merges bundled and system data` — bundled eng,tur; system eng,deu,osd → codes `['deu','eng','tur']`, `eng.source==='bundled'`.
  - `shareAvailable needs qml6 and the purpose module` — PATH with fake `qml6` + temp `QML_IMPORT_PATH/org/kde/purpose/qmldir` → true; either missing → false.
- [ ] **Step 2:** `node --test tests/desktop-integration.test.cjs` → FAIL.
- [ ] **Step 3:** Implement `lib/desktop-integration.cjs`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Sync and commit `feat(linux): desktop integration for open-with, QR, OCR languages and share`.

### Task 4: Remaining actions and main-process wiring

**Files:**
- Modify: `lib/output-actions.cjs` (add methods)
- Create: `assets/share.qml`
- Modify: `main.cjs` (commands, watcher, `commitCapture`, `recognize`, notifications, quit cleanup)
- Test: `tests/output-actions.test.cjs` (append), `tests/capture-commit-hides.test.cjs` (extend if it inspects `main.cjs` source; read it first)

**Interfaces — Consumes:** Tasks 2–3.

**Interfaces — Produces:**
- `OutputActions` methods: `async info() -> {defaultFolder, formats:['png','jpg','webp'], format, apps:[{id,name}], languages:[{code,name}], defaultLanguages, shareAvailable, codeAvailable}` (apps cached 60 s; availability cached for the process); `async openWith(id, appId)` (appId must be one returned by `imageApps`; spawn `launchCommand` detached, `stdio:'ignore'`, `unref`); `async print(id)` (calls injected `print(file)`); `async share(id)` (spawn `qml6 <assetsDir>/share.qml -- <file>` detached); `async extractText(id, languages=settings.output.ocrLanguages)` (calls injected `ocr(id, languages) -> {text}`; non-empty → `writeText`, notify `textCopied`, returns `{text}`; empty → notify `noText`); `async scanCode(id)` (`scanCodes(await externalFile(id))`; first text code → `writeText` + `codeFound`/`codesFound` (preview cut to 80 chars); only binary → `codeBinary`; none → `noCode`; returns `{codes}`). Constructor gains `spawn` (default `child_process.spawn`) and `assetsDir`.
- `main.cjs` commands (all through `command()`): `outputInfo` → `info()`; `outputPlan {id, mode}`; `outputWrite {token, dataUrl?}`; `outputRun {id, action, app?, languages?}` with `action ∈ copyLocation|reveal|openWith|print|share|extractText|scanCode`. Results are returned as `result`.
- `commitCapture` accepts `copy:false`: skips `writeImageClipboard`, the beep and `markCopied`; everything else identical; `result={id}`.
- `announce(text,{file})` in `main.cjs` = the `notify` dep: window visible → existing `notify(text)` toast; hidden → `new Notification({title:'ClipBoardLine',body:text,silent:true})` (skipped in `testMode` or unsupported), click → `shell.showItemInFolder(file)` when `file`.
- `print(file)` in `main.cjs`: hidden sandboxed `BrowserWindow` (`show:false`, no preload, `javascript:false`) loads a temp HTML page beside the temp image (`<img>` with `max-width:100%;max-height:100vh;object-fit:contain`, `@page{margin:10mm}`), then `webContents.print({silent:false,printBackground:true}, cb)`; destroy in `cb`; resolve/reject with the callback result.
- `recognize(id, quiet, languages=['eng','tur'])`: language files prepared with `fs.promises` (bundled `.gz` copied; system `.traineddata` gzip-copied with `zlib.createGzip` + `stream/promises.pipeline` into `ocr-models`); `item.ocrText` read/written only when `languages` is exactly `['eng','tur']`. `ocr(id, quiet, languages)` keys `ocrJobs` by `id+':'+languages.join('+')`.
- Watcher: `configureWatchers` callback returns early when `output.ownsFile(file)`.
- `before-quit`: `void output?.cleanup()`.
- `assets/share.qml`: `ApplicationWindow` 420×520, title "Share" ("Paylaş" when `Qt.uiLanguage` starts with `tr`), `Purpose.AlternativesView` with `pluginType:"Export"`, `inputData:{urls:[Qt.resolvedUrl("file://"+file)], mimeType:"image/png"}` where `file` = last of `Qt.application.arguments`; `Qt.quit()` on `finished` and on window close.

- [ ] **Step 1: Write the failing tests** (fakes for `spawn`, `print`, `ocr`, `integration`):
  - `openWith launches only listed apps with a non-media file` — fake integration lists `b.desktop`; `openWith(id,'b.desktop')` spawns `gio` with `['launch','/apps/b.desktop',<temp or saved path>]`, `detached:true`; path is not `store.mediaPath(id)`; `openWith(id,'evil.desktop')` throws.
  - `extractText copies recognized text with chosen languages` — fake `ocr` records `['deu']` and returns `'Hallo'` → `writeText('Hallo')`, notify `Text copied`; empty text → notify `No text found`, no write.
  - `scanCode copies the first text code` — integration returns two codes → `writeText(first)`, notify matches `/2 codes found/`; binary only → `Code found with binary content`, no write; none → `No QR code or barcode found`.
  - `share spawns qml6 with the share script` — args `[<assetsDir>/share.qml,'--',file]`.
  - `info reports apps, languages and availability` — shape as in Produces.
- [ ] **Step 2:** `node --test tests/output-actions.test.cjs` → new tests FAIL.
- [ ] **Step 3:** Implement the methods, `assets/share.qml`, and the `main.cjs` wiring (construct `output = new OutputActions({...})` after `store` in `whenReady`, `assetsDir:path.join(__dirname,'assets')`, `runtimeDir:process.env.XDG_RUNTIME_DIR`, `language` resolved from `store.data.settings.language` / `app.getLocale()`, `writeText:text=>writeMarkedClipboard({'text/plain':new Blob([text],{type:'text/plain'})})`, `reveal:file=>shell.showItemInFolder(file)`, `dialog:{showSaveDialog:o=>desiredVisible&&window.isVisible()?dialog.showSaveDialog(window,o):dialog.showSaveDialog(o)}`). `revealFile` prefers `await output.savedFile(id)`.
- [ ] **Step 4:** `npm test` → all pass; `node --check main.cjs`.
- [ ] **Step 5:** Sync (`lib/output-actions.cjs`, `main.cjs`, `assets/share.qml`) and commit `feat(linux): open-with, print, share, OCR languages, QR and main wiring`.

### Task 5: Renderer — shared output menu and Library surfaces

**Files:**
- Modify: `renderer.js`, `styles.css`
- Test: `tests/renderer-ui.test.cjs` (append; extend the fixture's fake `command` for `outputInfo/outputPlan/outputWrite/outputRun`)

**Interfaces — Consumes:** Task 4 commands.

**Interfaces — Produces (inside `renderer.js`):**
- `async runOutput(action, id, {app, language}={}) -> boolean` — the only entry for both surfaces. `save`/`saveAs` → `saveOutput(id, mode)`; `copyLocation`/`reveal` → `outputRun`, on `{needsSave:true}` run `saveOutput(id,'save')` then retry once; `openWith` (`app`), `print`, `share`, `scanCode`, `extractText` (`languages: language?[language]:undefined`) → `outputRun`. Errors → `toast`.
- `async saveOutput(id, mode) -> string|null` — `outputPlan`; canceled → null; `format==='png'` → `outputWrite {token}`; else `outputWrite {token, dataUrl: await encodeOutput(item(id).mediaUrl, format, quality)}`.
- `async encodeOutput(url, format, quality) -> string` — `fetch(url)` → `createImageBitmap` → canvas (`OffscreenCanvas` if present, else `document.createElement('canvas')`), white fill for `jpg`, `image/jpeg|image/webp`, `quality/100` → data URL.
- `ui.outputMenu = {id, x, y, index, info}`; `openOutputMenu(id, {x, y})` fetches `outputInfo` (cached in `ui.outputInfo` for 60 s) and renders `<div class="output-menu" id="output-menu" role="menu">` with rows `<button role="menuitem" data-action="output-run" data-output="<action>" [data-app] [data-language]>`: Save `Ctrl+S`, Save As… `Ctrl+Shift+S`, Copy location, Open containing folder, header "Open with" then one row per app, Print, Share (only if `shareAvailable`), Extract text, one "Extract text · <name>" per language, Scan QR code (only if `codeAvailable`). ArrowUp/Down move, Enter runs, Esc closes, click outside closes. Rendered in a container that exists in every view (capture included).
- Library entry points: image preview toolbar button `data-action="output-menu"` (icon `copy` or a new `export` icon, label "Export"); right-click (`contextmenu`) on an image card `[data-item-id]` (non-recording, not trashed) opens the menu at the pointer; new `DEFAULT_KEYS` `saveImageFile:'Ctrl+S'`, `saveImageFileAs:'Ctrl+Shift+S'`, `outputMenu:'Ctrl+E'` with `ACTION_TITLES` "Save image to file", "Save image as…", "Export menu", allowed in `shelves`, `library`, `imagePreview` (not `imageMarkup`) when the focused item is a still image; Actions palette entries `output-save`, `output-saveAs`, `output-copyLocation`, `output-reveal`, `output-print`, `output-share`, `output-extractText`, `output-scanCode` (disabled with "Select a still image first." otherwise).
- Turkish: add every new string to `TR`, at least: Export→Dışa aktar, Save→Kaydet (exists), Save As…→Farklı kaydet…, Copy location→Konumu kopyala, Open containing folder→İçeren klasörü aç, Open with→Birlikte aç, Print→Yazdır, Share→Paylaş, Extract text→Metni çıkar, Extract text · %@→Metni çıkar · %@, Scan QR code→QR kodu tara, Save image to file→Görseli dosyaya kaydet, Save image as…→Görseli farklı kaydet…, Export menu→Dışa aktarma menüsü, Saving image…→Görsel kaydediliyor…, No other applications found→Başka uygulama bulunamadı.

- [ ] **Step 1: Write the failing tests:**
  - `image preview Export button opens the output menu with every action` — Space on the image, click `output-menu` → overlay/menu contains `data-output="save"`, `saveAs`, `copyLocation`, `reveal`, `openWith` row for the fake app, `print`, `extractText`, `scanCode`; `share` absent when `shareAvailable:false`.
  - `Ctrl+S on a focused image saves a PNG without encoding` — commands `outputPlan {id, mode:'save'}` then `outputWrite {token}` with no `dataUrl`.
  - `jpg plans send an encoded data URL with the plan token` — fake `outputPlan` returns `format:'jpg'` → `outputWrite.payload.token` equals plan token and `dataUrl` starts `data:image/jpeg` (stub `fetch`/`createImageBitmap`/canvas in the fixture).
  - `copy location saves first when main asks` — fake `outputRun` returns `{needsSave:true}` once → sequence `outputRun, outputPlan, outputWrite, outputRun`.
  - `right-click on an image card opens the output menu; on a text card it does not`.
  - `output menu keyboard: ArrowDown + Enter runs the second action, Escape closes`.
  - `Turkish UI shows Turkish output labels` — language `tr` → `Farklı kaydet…`, `Konumu kopyala`, `QR kodu tara`.
- [ ] **Step 2:** `node --test tests/renderer-ui.test.cjs` → new tests FAIL.
- [ ] **Step 3:** Implement in `renderer.js` / `styles.css` (menu uses the existing glass dialog colours; max-height 70vh with scroll).
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Sync and commit `feat(linux): shared output menu on Library image items`.

### Task 6: Capture overlay output actions

**Files:**
- Modify: `renderer.js` (`captureWorkspace` toolbar, capture key handler, `commitCaptureSession`), `styles.css` if needed
- Test: `tests/renderer-ui.test.cjs` (append)

**Interfaces — Consumes:** Task 5 `runOutput`, `openOutputMenu`; Task 4 `commitCapture {copy:false}`.

**Interfaces — Produces:**
- `capturePayload(session) -> {dataUrl, originalRect?, annotations?}` — extracted from `commitCaptureSession` unchanged; `commitCaptureSession` uses it and sends exactly what it sends today.
- `async captureOutput(action, options={})` — `capturePayload`, `ui.captureSession=null`, `command('commitCapture',{...payload, copy:false})`, then `runOutput(action, result.result.id, options)`; on failure restore like `commitCaptureSession`.
- Capture toolbar (before Cancel): buttons `data-action="capture-output" data-output="save"` "Save" `Ctrl+S`, `data-output="saveAs"` "Save As…", and `data-action="capture-output-menu"` "Export" `Ctrl+E`; the menu in capture runs `captureOutput` instead of `runOutput`. The existing "Save to line" button keeps Enter.
- Keys (not while `isEditor(target)`): Ctrl+S save, Ctrl+Shift+S saveAs, Ctrl+Shift+C copyLocation, Ctrl+P print, Ctrl+E menu. Esc with the menu open closes only the menu.

- [ ] **Step 1: Write the failing tests:**
  - `capture Ctrl+S commits without copying then saves` — after a crop drag, Ctrl+S → `commitCapture` payload has `copy:false` and the same `dataUrl`/`originalRect` shape as Enter, followed by `outputPlan {mode:'save'}` for the returned id.
  - `capture Enter and Ctrl+C payloads are unchanged` — no `copy` key in either payload.
  - `capture Ctrl+Shift+C copies the location` — `commitCapture{copy:false}` then `outputRun {action:'copyLocation'}`.
  - `capture toolbar shows Save, Save As and Export` — buttons present with Turkish labels when language is `tr`.
  - `Escape closes the output menu before cancelling the capture` — Ctrl+E then Esc → no `cancelCapture`, menu gone, capture still open; second Esc → `cancelCapture`.
  - `capture menu Print runs on the committed item` — choose `print` → `commitCapture{copy:false}` then `outputRun{action:'print'}`.
- [ ] **Step 2:** `node --test tests/renderer-ui.test.cjs` → new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Sync and commit `feat(linux): output actions in the capture overlay`.

### Final (controller)

- [ ] Whole-branch review (most capable model) against the spec and Review Focus; one fix wave; `npm test`.
- [ ] Verify the three copies are identical (`diff -r` excluding `tests/` for dist), restart `app-clipboardline@autostart.service`, check `busctl --user call org.kde.kglobalaccel /component/clipboardline org.kde.kglobalaccel.Component shortcutNames` lists 4 names and `journalctl --user -u app-clipboardline@autostart.service --since -2min` has no errors; one real `zbarimg` run on a `qrencode` PNG outside the test suite.
