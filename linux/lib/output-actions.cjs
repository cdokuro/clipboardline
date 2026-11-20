'use strict';
// Shared main-process engine for output actions (save, save as, location, temp copies, notifications).
// Electron pieces (dialog, clipboard, shell, Notification) are injected so the module stays testable.
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const childProcess = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');
const desktopIntegration = require('./desktop-integration.cjs');

const FORMATS = {
  png: { extension: '.png', mime: 'image/png' },
  jpg: { extension: '.jpg', mime: 'image/jpeg' },
  webp: { extension: '.webp', mime: 'image/webp' },
};
const TOKEN_LIFETIME = 120_000, OWN_LIFETIME = 30_000, APPS_LIFETIME = 60_000, PREVIEW = 80, MAX_LANGUAGES = 16, TEMP_MAX_AGE = 3_600_000, MAX_NAME = 200, MAX_ATTEMPTS = 10000, MAX_DATA_URL = 90_000_000, MAX_FAILURE = 300;

function fail(message, extra) { throw Object.assign(new Error(message), extra); }

function formatFromExtension(extension) {
  const value = String(extension || '').toLowerCase().replace(/^\./, '');
  if (value === 'png') return 'png';
  if (value === 'jpg' || value === 'jpeg') return 'jpg';
  if (value === 'webp') return 'webp';
  return null;
}

function matchesFormat(buffer, format) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (format === 'png') return buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (format === 'jpg') return buffer.length >= 3 && buffer.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (format === 'webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

const pad = value => String(value).padStart(2, '0');
function fileBaseName(template, date, { title = '', number = 1 } = {}) {
  const values = {
    yyyy: String(date.getFullYear()), yy: pad(date.getFullYear() % 100), MM: pad(date.getMonth() + 1), dd: pad(date.getDate()),
    hh: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()), title: String(title || ''), '#': String(number),
  };
  const text = String(template).replace(/<(yyyy|yy|MM|dd|hh|mm|ss|title|#)>/g, (_match, key) => values[key]);
  const clean = text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/^[ ._-]+|[ ._-]+$/g, '');
  const cut = clean.slice(0, MAX_NAME).replace(/[ ._-]+$/g, '');
  return cut || 'Screenshot';
}

async function uniqueOutputPath(folder, template, date, { title = '', extension = '.png', exists } = {}) {
  const taken = exists || (async file => { try { await nodeFs.promises.access(file); return true; } catch { return false; } });
  const numbered = String(template).includes('<#>');
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    let name;
    if (numbered) name = fileBaseName(template, date, { title, number: n });
    else name = n === 1 ? fileBaseName(template, date, { title }) : fileBaseName(template, date, { title }) + '-' + n;
    const file = path.join(folder, name + extension);
    if (!(await taken(file))) return file;
  }
  return fail('A free filename could not be found', { code: 'ENONAME' });
}

async function defaultSaveFolder({ home, configHome, readFile = file => nodeFs.promises.readFile(file, 'utf8') } = {}) {
  const read = async file => { try { return String(await readFile(path.join(configHome, file), 'utf8')); } catch { return ''; } };
  let pictures = path.join(home, 'Pictures');
  const dirs = await read('user-dirs.dirs');
  const match = /^\s*XDG_PICTURES_DIR\s*=\s*(.+?)\s*$/m.exec(dirs);
  if (match) {
    let value = match[1].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/\$\{HOME\}|\$HOME/g, home);
    if (path.isAbsolute(value)) pictures = path.normalize(value);
  }
  let sub = 'Screenshots';
  const rc = await read('spectaclerc');
  let section = '';
  for (const line of rc.split(/\r?\n/)) {
    const header = /^\s*\[(.*)\]\s*$/.exec(line);
    if (header) { section = header[1]; continue; }
    const pair = /^\s*translatedScreenshotsFolder\s*=\s*(.*?)\s*$/.exec(line);
    if (pair && section === 'ImageSave' && pair[1] && !/[\\/]/.test(pair[1]) && pair[1] !== '..' && pair[1] !== '.') sub = pair[1];
  }
  return path.join(pictures, sub);
}

const TEXT = {
  saved: ['Saved as %1 to %2', '%1 olarak %2 klasörüne kaydedildi'],
  locationCopied: ['File location copied', 'Dosya konumu kopyalandı'],
  textCopied: ['Text copied', 'Metin kopyalandı'],
  noText: ['No text found', 'Metin bulunamadı'],
  codeFound: ['Code found: %1 (copied)', 'Kod bulundu: %1 (kopyalandı)'],
  codesFound: ['%1 codes found; first copied: %2', '%1 kod bulundu; ilki kopyalandı: %2'],
  codeBinary: ['Code found with binary content', 'İkili içerikli kod bulundu'],
  noCode: ['No QR code or barcode found', 'QR kod veya barkod bulunamadı'],
  saveFailed: ['The image could not be saved: %1', 'Görsel kaydedilemedi: %1'],
  actionFailed: ['The action failed: %1', 'İşlem başarısız oldu: %1'],
  libraryFailed: ['The screenshot could not be saved to the Library: %1', 'Ekran görüntüsü Kütüphane’ye kaydedilemedi: %1'],
  libraryFailedCopied: ['Screenshot copied, but it could not be saved to the Library: %1', 'Ekran görüntüsü kopyalandı ancak Kütüphane’ye kaydedilemedi: %1'],
  imagesOnly: ['Only images can be saved', 'Yalnızca görseller kaydedilebilir'],
  invalidMode: ['Invalid save mode', 'Geçersiz kaydetme kipi'],
  invalidSavePath: ['Invalid save path', 'Geçersiz kayıt yolu'],
  tokenUnknown: ['Unknown or used save token', 'Bilinmeyen veya kullanılmış kayıt belirteci'],
  tokenExpired: ['The save token expired; try again', 'Kayıt belirtecinin süresi doldu; tekrar dene'],
  invalidImageData: ['Invalid image data', 'Geçersiz görsel verisi'],
  formatMismatch: ['The image data does not match the format', 'Görsel verisi biçimle eşleşmiyor'],
  noFreeName: ['A free filename could not be found', 'Boş bir dosya adı bulunamadı'],
  tempNotPrivate: ['The temporary folder is not private', 'Geçici klasör yalnızca sana ait değil'],
  tempFailed: ['A temporary filename could not be created', 'Geçici dosya adı oluşturulamadı'],
  appUnavailable: ['This application is not available for images', 'Bu uygulama görseller için kullanılamıyor'],
  printUnavailable: ['Printing is unavailable', 'Yazdırma kullanılamıyor'],
  printFailed: ['Printing failed: %1', 'Yazdırma başarısız oldu: %1'],
  printTimedOut: ['Printing timed out', 'Yazdırma zaman aşımına uğradı'],
  shareUnavailable: ['Sharing is unavailable', 'Paylaşım kullanılamıyor'],
  ocrUnavailable: ['Text recognition is unavailable', 'Metin tanıma kullanılamıyor'],
  noOcrLanguage: ['No OCR language is installed', 'Kurulu OCR dili yok'],
  ocrLanguageMissing: ['OCR language is not installed: %1', 'OCR dili kurulu değil: %1'],
  invalidOcrLanguages: ['Invalid OCR languages', 'Geçersiz OCR dilleri'],
  scanFailed: ['The QR code scan failed: %1', 'QR kod taraması başarısız oldu: %1'],
  timedOut: ['timed out', 'zaman aşımı'],
  zbarMissing: ['QR code scanning needs zbarimg (zbar) to be installed', 'QR kod taraması için zbarimg (zbar) kurulmalı'],
  unknownAction: ['Unknown output action', 'Bilinmeyen çıktı işlemi'],
  imageChanged: ['Image changed during recognition', 'Görsel, tanıma sırasında değişti'],
  imageOpenFailed: ['The image could not be opened.', 'Görsel açılamadı.'],
  toolMissing: ['%1 is not installed', '%1 kurulu değil'],
  fileExists: ['A file with this name already exists', 'Bu adda bir dosya zaten var'],
  permissionDenied: ['Permission denied', 'İzin reddedildi'],
  diskFull: ['No space left on the disk', 'Diskte yer kalmadı'],
  readOnly: ['The folder is read-only', 'Klasör salt okunur'],
  notFound: ['The file or folder does not exist', 'Dosya veya klasör yok'],
  notFolder: ['The path is not a folder', 'Yol bir klasör değil'],
};
function outputText(language, key, ...values) {
  const entry = TEXT[key]; if (!entry) return String(key);
  let turkish = language === 'tr';
  if (language === 'system') turkish = /^tr/i.test(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '');
  return entry[turkish ? 1 : 0].replace(/%(\d)/g, (_m, n) => String(values[Number(n) - 1] ?? ''));
}

const ERROR_KEYS = { EEXIST: 'fileExists', EACCES: 'permissionDenied', EPERM: 'permissionDenied', ENOSPC: 'diskFull', EDQUOT: 'diskFull', EROFS: 'readOnly', ENOENT: 'notFound', ENOTDIR: 'notFolder', ENONAME: 'noFreeName' };
// User-facing text for an error: system error codes and our coded errors are translated; others keep their (already translated) message.
function describeError(language, error) {
  const code = error?.code;
  if (code === 'EPRINT') return error.reason === 'timeout' ? outputText(language, 'printTimedOut') : outputText(language, 'printFailed', error.reason || '?');
  if (code === 'ENOLANG') return outputText(language, 'ocrLanguageMissing', error.language);
  if (code === 'ENOENT' && /^spawn/.test(String(error.syscall || ''))) return outputText(language, 'toolMissing', path.basename(String(error.path || '?')));
  if (typeof code === 'string' && ERROR_KEYS[code]) return outputText(language, ERROR_KEYS[code]);
  return String(error?.message || error);
}

const LANGUAGE_CODE = /^[a-z0-9_]{1,32}$/i;
const exists = async (fs, file) => { try { await fs.access(file); return true; } catch { return false; } };

// Puts <code>.traineddata.gz for every language into `directory` (tesseract.js langPath, gzip:true).
// Bundled files are copied; system tessdata is gzip-compressed once. `available()` is asked only
// when a file is missing, so the background index does no directory scans once the cache is warm.
async function prepareOcrLanguages({ languages, directory, available, fs = nodeFs.promises }) {
  await fs.mkdir(directory, { recursive: true });
  let installed = null;
  for (const code of languages) {
    if (typeof code !== 'string' || !LANGUAGE_CODE.test(code)) fail('Invalid OCR language');
    const destination = path.join(directory, code + '.traineddata.gz');
    if (await exists(fs, destination)) continue;
    installed ??= await available();
    const entry = installed.find(language => language.code === code);
    if (!entry) fail('OCR language is not installed: ' + code, { code: 'ENOLANG', language: code });
    const temporary = destination + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    try {
      if (entry.source === 'system') await pipeline(nodeFs.createReadStream(entry.file), zlib.createGzip(), nodeFs.createWriteStream(temporary, { flags: 'wx' }));
      else await fs.copyFile(entry.file, temporary, nodeFs.constants.COPYFILE_EXCL);
      await fs.rename(temporary, destination);
    } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
  }
}

const NOTICE_LIFETIME = 60_000;
// Visible window → in-app toast; hidden → silent desktop notification whose click reveals the file.
// Shown notifications are kept in `live` so they are not garbage-collected (which would drop the
// click handler) until they are clicked, closed or failed, or NOTICE_LIFETIME passes.
function createAnnouncer({ visible, toast, Notification, testMode, reveal, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const live = new Set();
  const announce = (text, { file } = {}) => {
    if (visible() || testMode || !Notification?.isSupported?.()) return toast(text);
    const notice = new Notification({ title: 'ClipBoardLine', body: text, silent: true });
    let timer = null;
    const release = () => { if (!live.delete(notice)) return; if (timer) clearTimer(timer); };
    live.add(notice);
    timer = setTimer(release, NOTICE_LIFETIME);
    timer?.unref?.();
    notice.on('click', () => { release(); if (file) { try { reveal(file); } catch { /* ignore */ } } });
    notice.on('close', release);
    notice.on('failed', release);
    notice.show();
  };
  announce.live = live;
  return announce;
}

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function printPage(file) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(path.basename(file)) + '</title>'
    + '<style>@page{margin:10mm}html,body{margin:0;padding:0;background:#fff}body{display:flex;align-items:center;justify-content:center;height:100vh}'
    + 'img{display:block;max-width:100%;max-height:100vh;object-fit:contain}</style></head>'
    + '<body><img src="' + escapeHtml(pathToFileURL(file).href) + '" alt=""></body></html>';
}

// Prints `file` through a hidden, sandboxed, script-free window and the system print dialog.
// The HTML page is left in `directory` for the temp folder's age-based cleanup.
const PRINT_TIMEOUT = 600_000;
async function printWithWindow(file, { BrowserWindow, directory, fs = nodeFs.promises, timeout = PRINT_TIMEOUT }) {
  const page = path.join(directory, path.basename(file, path.extname(file)) + '-' + crypto.randomBytes(3).toString('hex') + '.html');
  await fs.writeFile(page, printPage(file), { flag: 'wx', mode: 0o600 });
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  const destroy = () => { try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ } };
  try { await win.loadFile(page); } catch (error) { destroy(); throw error; }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (settle, value) => { if (done) return; done = true; clearTimeout(timer); destroy(); settle(value); };
    // A print dialog that never answers must not keep the hidden window forever.
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('Printing timed out'), { code: 'EPRINT', reason: 'timeout' })), timeout);
    timer.unref?.();
    try {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success) finish(resolve, { printed: true });
        else if (reason === 'cancelled') finish(resolve, { printed: false });
        else finish(reject, Object.assign(new Error('Printing failed' + (reason ? ': ' + reason : '')), { code: 'EPRINT', reason: reason || '' }));
      });
    } catch (error) { finish(reject, error); }
  });
}

const RUN_ACTIONS = new Set(['copyLocation', 'reveal', 'openWith', 'print', 'share', 'extractText', 'scanCode']);

class OutputActions {
  constructor({ store, settings, fs = nodeFs.promises, now = () => new Date(), home, configHome, runtimeDir, language = () => 'en',
    dialog, writeText, reveal, notify, integration = desktopIntegration, print = null, ocr = null,
    spawn = childProcess.spawn, assetsDir = path.join(__dirname, '..', 'assets'), env = process.env, ocrBundledDir = null, ocrSystemDirs } = {}) {
    Object.assign(this, { store, settings, fs, now, home, configHome, runtimeDir, language, dialog, writeText, reveal, notify, integration, print, ocr,
      spawn, assetsDir, env, ocrBundledDir, ocrSystemDirs });
    this.tokens = new Map();
    this.owned = new Map();
    this.cache = new Map();
    this.tempDirectory = runtimeDir ? path.join(runtimeDir, 'clipboardline-output') : path.join(os.tmpdir(), 'clipboardline-output-' + process.getuid());
  }

  say(key, ...values) { return outputText(this.language(), key, ...values); }
  tell(text, extra) { try { this.notify?.(text, extra); } catch { /* notifications are best effort */ } }
  time() { return this.now().getTime(); }

  imageItem(id) {
    const item = this.store.item(id);
    if (item.kind !== 'image' || item.recording) fail(this.say('imagesOnly'));
    return item;
  }

  async plan(id, mode) {
    if (mode !== 'save' && mode !== 'saveAs') fail(this.say('invalidMode'));
    const item = this.imageItem(id), output = this.settings().output;
    let format = output.format;
    if (!FORMATS[format]) format = 'png';
    const time = this.time();
    for (const [key, entry] of this.tokens) if (entry.expires < time) this.tokens.delete(key);
    // A path promised to a pending (unexpired) plan is taken, even though nothing is written there yet.
    const held = new Set([...this.tokens.values()].map(entry => path.resolve(entry.path)));
    const exists = async file => held.has(path.resolve(file)) || (async () => { try { await this.fs.access(file); return true; } catch { return false; } })();
    const folder = output.saveFolder || await defaultSaveFolder({ home: this.home, configHome: this.configHome });
    const planned = await uniqueOutputPath(folder, output.filenameTemplate, this.now(), { title: item.name || item.title || '', extension: FORMATS[format].extension, exists });
    let file = planned, confirmed = false;
    if (mode === 'saveAs') {
      const result = await this.dialog.showSaveDialog({
        defaultPath: planned,
        filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg', 'jpeg'] }, { name: 'WebP', extensions: ['webp'] }],
      });
      if (!result || result.canceled || !result.filePath) return { canceled: true };
      file = result.filePath;
      if (typeof file !== 'string' || !path.isAbsolute(file)) fail(this.say('invalidSavePath'));
      const chosen = formatFromExtension(path.extname(file));
      // Only the exact path the user confirmed in the dialog may be overwritten.
      if (chosen) { format = chosen; confirmed = true; } else file += FORMATS[format].extension;
    }
    const token = crypto.randomUUID();
    this.tokens.set(token, { id, path: file, format, quality: output.quality, confirmed, expires: this.time() + TOKEN_LIFETIME });
    return { token, path: file, format, quality: output.quality };
  }

  async write(token, dataUrl = null) {
    const plan = this.tokens.get(token);
    this.tokens.delete(token);
    if (!plan) fail(this.say('tokenUnknown'));
    if (this.time() > plan.expires) fail(this.say('tokenExpired'));
    await this.fs.mkdir(path.dirname(plan.path), { recursive: true });
    // Owned before the first byte lands, so a watched folder never imports this file.
    const resolved = path.resolve(plan.path);
    this.owned.set(resolved, this.time() + OWN_LIFETIME);
    try { await this.writePlanned(plan, dataUrl); } catch (error) { this.owned.delete(resolved); throw error; }
    try { const real = await this.fs.realpath(plan.path); if (real !== resolved) this.owned.set(real, this.time() + OWN_LIFETIME); } catch { /* best effort */ }
    this.store.setSavedPath(plan.id, plan.path);
    this.tell(this.say('saved', path.basename(plan.path), path.dirname(plan.path)), { file: plan.path });
    return { path: plan.path };
  }

  async writePlanned(plan, dataUrl) {
    const { constants } = nodeFs;
    if (plan.format === 'png' && dataUrl == null) {
      await this.fs.copyFile(this.store.mediaPath(plan.id), plan.path, plan.confirmed ? 0 : constants.COPYFILE_EXCL);
    } else {
      const mime = FORMATS[plan.format].mime, prefix = `data:${mime};base64,`;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > MAX_DATA_URL) fail(this.say('invalidImageData'));
      const body = dataUrl.slice(prefix.length);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) fail(this.say('invalidImageData'));
      const bytes = Buffer.from(body, 'base64');
      if (!matchesFormat(bytes, plan.format)) fail(this.say('formatMismatch'));
      await this.fs.writeFile(plan.path, bytes, { flag: plan.confirmed ? 'w' : 'wx', mode: 0o644 });
    }
  }

  ownsFile(file) {
    const key = path.resolve(String(file)), expires = this.owned.get(key), time = this.time();
    for (const [name, until] of this.owned) if (until < time) this.owned.delete(name);
    return expires !== undefined && expires >= time;
  }

  async savedFile(id) {
    const saved = this.store.item(id).savedPath;
    if (!saved) return null;
    try { return (await this.fs.stat(saved)).isFile() ? saved : null; } catch { return null; }
  }

  async copyLocation(id) {
    const file = await this.savedFile(id);
    if (!file) return { needsSave: true };
    await this.writeText(file);
    this.tell(this.say('locationCopied'));
    return { path: file };
  }

  async revealSaved(id) {
    const file = await this.savedFile(id);
    if (!file) return { needsSave: true };
    await this.reveal(file);
    return { path: file };
  }

  async externalFile(id) {
    const item = this.imageItem(id), saved = await this.savedFile(id);
    await this.fs.mkdir(this.tempDirectory, { recursive: true, mode: 0o700 });
    const info = await this.fs.lstat(this.tempDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) fail(this.say('tempNotPrivate'));
    try {
      const cutoff = Date.now() - TEMP_MAX_AGE; // file mtimes are wall-clock, not the injected clock
      for (const name of await this.fs.readdir(this.tempDirectory)) {
        const file = path.join(this.tempDirectory, name);
        try { const info = await this.fs.lstat(file); if (info.isFile() && info.mtimeMs < cutoff) await this.fs.unlink(file); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    if (saved) return saved;
    const base = fileBaseName(this.settings().output.filenameTemplate, this.now(), { title: item.name || item.title || '' });
    const bytes = await this.fs.readFile(this.store.mediaPath(id));
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = path.join(this.tempDirectory, base + '-' + this.suffix() + '.png');
      try { await this.fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); return file; } // O_EXCL: never follows or replaces an existing entry
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    fail(this.say('tempFailed'));
  }

  suffix() { return crypto.randomBytes(3).toString('hex'); }

  // Memoised lookups: `ttl` null = for the life of the process.
  async cached(key, ttl, load) {
    const hit = this.cache.get(key), time = this.time();
    if (hit && (hit.until === null || hit.until > time)) return hit.value;
    const value = load();
    this.cache.set(key, { value, until: ttl === null ? null : time + ttl });
    try { return await value; } catch (error) { this.cache.delete(key); throw error; }
  }

  uiLanguage() { return this.language() === 'tr' ? 'tr' : 'en'; }

  apps() {
    const language = this.uiLanguage();
    return this.cached('apps:' + language, APPS_LIFETIME, () => this.integration.imageApps({ env: this.env, home: this.home, language }));
  }

  installedLanguages() {
    const options = { bundledDir: this.ocrBundledDir, ...(this.ocrSystemDirs ? { systemDirs: this.ocrSystemDirs } : {}) };
    return this.cached('languages', APPS_LIFETIME, () => this.integration.ocrLanguages(options));
  }

  shareAvailable() { return this.cached('share', null, () => this.integration.shareAvailable({ env: this.env })); }
  codeAvailable() { return this.cached('zbarimg', null, () => this.integration.toolAvailable('zbarimg', this.env)); }

  async info() {
    const output = this.settings().output, language = this.uiLanguage();
    const [defaultFolder, apps, languages, shareAvailable, codeAvailable] = await Promise.all([
      output.saveFolder || defaultSaveFolder({ home: this.home, configHome: this.configHome }),
      this.apps(), this.installedLanguages(), this.shareAvailable(), this.codeAvailable()]);
    const installed = new Set(languages.map(entry => entry.code));
    return {
      defaultFolder, formats: Object.keys(FORMATS), format: FORMATS[output.format] ? output.format : 'png',
      apps: apps.map(entry => ({ id: entry.id, name: entry.name })),
      languages: languages.map(entry => ({ code: entry.code, name: entry.name?.[language] || entry.name?.en || entry.code })),
      defaultLanguages: output.ocrLanguages.filter(code => installed.has(code)),
      shareAvailable, codeAvailable,
    };
  }

  async launch(command, args) {
    const child = this.spawn(command, args, { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }

  async openWith(id, appId) {
    this.imageItem(id);
    const entry = typeof appId === 'string' ? (await this.apps()).find(candidate => candidate.id === appId) : null;
    if (!entry) fail(this.say('appUnavailable'));
    const file = await this.externalFile(id);
    const { command, args } = (this.integration.launchCommand || desktopIntegration.launchCommand)(entry.file, file);
    await this.launch(command, args);
    return { path: file };
  }

  async printImage(id) {
    if (typeof this.print !== 'function') fail(this.say('printUnavailable'));
    this.imageItem(id);
    const file = await this.externalFile(id);
    try { return await this.print(file); } catch (error) { if (error?.code === 'EPRINT') fail(describeError(this.language(), error)); throw error; }
  }

  async share(id) {
    this.imageItem(id);
    if (!(await this.shareAvailable())) fail(this.say('shareUnavailable'));
    const file = await this.externalFile(id);
    // The saved file may be a JPEG or WebP; Purpose needs its real MIME type.
    const mime = FORMATS[formatFromExtension(path.extname(file))]?.mime || FORMATS.png.mime;
    await this.launch('qml6', [path.join(this.assetsDir, 'share.qml'), '--', mime, file]);
    return { path: file };
  }

  async ocrLanguageList(requested) {
    const installed = new Set((await this.installedLanguages()).map(entry => entry.code));
    if (requested === undefined) {
      const list = this.settings().output.ocrLanguages.filter(code => installed.has(code));
      if (!list.length) fail(this.say('noOcrLanguage'));
      return list;
    }
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > MAX_LANGUAGES
      || requested.some(code => typeof code !== 'string' || !LANGUAGE_CODE.test(code) || !installed.has(code))) fail(this.say('invalidOcrLanguages'));
    return [...new Set(requested)];
  }

  async extractText(id, languages) {
    this.imageItem(id);
    if (typeof this.ocr !== 'function') fail(this.say('ocrUnavailable'));
    const list = await this.ocrLanguageList(languages);
    const text = String((await this.ocr(id, list))?.text || '');
    if (!text.trim()) { this.tell(this.say('noText')); return { text: '' }; }
    await this.writeText(text);
    this.tell(this.say('textCopied'));
    return { text };
  }

  async scanCode(id) {
    this.imageItem(id);
    const file = await this.externalFile(id);
    let scanned;
    try { scanned = await this.integration.scanCodes(file, { env: this.env }); }
    catch (error) {
      const reason = error?.killed || error?.signal ? this.say('timedOut') : String(error?.message || error).split('\n')[0].slice(0, 120);
      fail(this.say('scanFailed', reason));
    }
    if (!scanned.available) fail(this.say('zbarMissing'));
    const codes = scanned.codes || [], texts = codes.filter(code => !code.binary && typeof code.text === 'string');
    if (texts.length) {
      const first = texts[0].text, flat = first.replace(/\s+/g, ' ').trim();
      const preview = flat.length > PREVIEW ? flat.slice(0, PREVIEW - 1) + '…' : flat;
      await this.writeText(first);
      this.tell(codes.length > 1 ? this.say('codesFound', codes.length, preview) : this.say('codeFound', preview));
    } else this.tell(this.say(codes.length ? 'codeBinary' : 'noCode'));
    return { codes };
  }

  // Single entry for the renderer's outputRun command; every argument is validated here.
  async run({ id, action, app, languages } = {}) {
    this.store.item(id);
    if (!RUN_ACTIONS.has(action)) fail(this.say('unknownAction'));
    if (action === 'copyLocation') return this.copyLocation(id);
    if (action === 'reveal') return this.revealSaved(id);
    if (action === 'openWith') return this.openWith(id, app);
    if (action === 'print') return this.printImage(id);
    if (action === 'share') return this.share(id);
    if (action === 'extractText') return this.extractText(id, languages);
    return this.scanCode(id);
  }

  // Entry for main's output commands. Failures are announced here (desktop notification while the
  // window is hidden, e.g. after a capture output action; toast otherwise) and rethrown with
  // `announced` set and the announced text as message, so main does not toast them again.
  async handle(action, payload = {}) {
    payload = payload && typeof payload === 'object' ? payload : {};
    if (action === 'outputInfo') return this.info();
    if (action === 'outputFailed') {
      const message = payload.message;
      if (typeof message !== 'string' || !message.trim() || message.length > MAX_FAILURE) fail('Invalid failure message');
      if (typeof payload.token === 'string') this.tokens.delete(payload.token); // the abandoned plan no longer holds its path
      this.tell(this.say('saveFailed', message.trim()));
      return { announced: true };
    }
    if (!['outputPlan', 'outputWrite', 'outputRun'].includes(action)) fail('Unknown output command');
    try {
      if (action === 'outputPlan') return await this.plan(payload.id, payload.mode);
      if (action === 'outputWrite') {
        if (typeof payload.token !== 'string') fail(this.say('tokenUnknown'));
        return await this.write(payload.token, payload.dataUrl ?? null);
      }
      return await this.run({ id: payload.id, action: payload.action, app: payload.app, languages: payload.languages });
    } catch (error) {
      const text = this.say(action === 'outputRun' ? 'actionFailed' : 'saveFailed', describeError(this.language(), error));
      this.tell(text);
      throw Object.assign(new Error(text), { announced: true, cause: error });
    }
  }

  async cleanup() {
    await this.fs.rm(this.tempDirectory, { recursive: true, force: true });
  }
}

module.exports = { FORMATS, formatFromExtension, matchesFormat, fileBaseName, uniqueOutputPath, defaultSaveFolder, outputText, describeError, prepareOcrLanguages, createAnnouncer, printPage, printWithWindow, OutputActions };
