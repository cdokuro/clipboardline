'use strict';
// Shared main-process engine for output actions (save, save as, location, temp copies, notifications).
// Electron pieces (dialog, clipboard, shell, Notification) are injected so the module stays testable.
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMATS = {
  png: { extension: '.png', mime: 'image/png' },
  jpg: { extension: '.jpg', mime: 'image/jpeg' },
  webp: { extension: '.webp', mime: 'image/webp' },
};
const TOKEN_LIFETIME = 120_000, OWN_LIFETIME = 30_000, TEMP_MAX_AGE = 3_600_000, MAX_NAME = 200, MAX_ATTEMPTS = 10000, MAX_DATA_URL = 90_000_000;

function fail(message) { throw new Error(message); }

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
  return fail('A free filename could not be found');
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
};
function outputText(language, key, ...values) {
  const entry = TEXT[key]; if (!entry) return String(key);
  let turkish = language === 'tr';
  if (language === 'system') turkish = /^tr/i.test(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '');
  return entry[turkish ? 1 : 0].replace(/%(\d)/g, (_m, n) => String(values[Number(n) - 1] ?? ''));
}

class OutputActions {
  constructor({ store, settings, fs = nodeFs.promises, now = () => new Date(), home, configHome, runtimeDir, language = () => 'en',
    dialog, writeText, reveal, notify, integration = null, print = null, ocr = null } = {}) {
    Object.assign(this, { store, settings, fs, now, home, configHome, runtimeDir, language, dialog, writeText, reveal, notify, integration, print, ocr });
    this.tokens = new Map();
    this.owned = new Map();
    this.tempDirectory = runtimeDir ? path.join(runtimeDir, 'clipboardline-output') : path.join(os.tmpdir(), 'clipboardline-output-' + process.getuid());
  }

  say(key, ...values) { return outputText(this.language(), key, ...values); }
  tell(text, extra) { try { this.notify?.(text, extra); } catch { /* notifications are best effort */ } }
  time() { return this.now().getTime(); }

  imageItem(id) {
    const item = this.store.item(id);
    if (item.kind !== 'image' || item.recording) fail('Only images can be saved');
    return item;
  }

  async plan(id, mode) {
    if (mode !== 'save' && mode !== 'saveAs') fail('Invalid save mode');
    const item = this.imageItem(id), output = this.settings().output;
    let format = output.format;
    if (!FORMATS[format]) format = 'png';
    const folder = output.saveFolder || await defaultSaveFolder({ home: this.home, configHome: this.configHome });
    const planned = await uniqueOutputPath(folder, output.filenameTemplate, this.now(), { title: item.name || item.title || '', extension: FORMATS[format].extension });
    let file = planned, confirmed = false;
    if (mode === 'saveAs') {
      const result = await this.dialog.showSaveDialog({
        defaultPath: planned,
        filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg', 'jpeg'] }, { name: 'WebP', extensions: ['webp'] }],
      });
      if (!result || result.canceled || !result.filePath) return { canceled: true };
      file = result.filePath;
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
    if (!plan) fail('Unknown or used save token');
    if (this.time() > plan.expires) fail('The save token expired');
    const { constants } = nodeFs;
    await this.fs.mkdir(path.dirname(plan.path), { recursive: true });
    if (plan.format === 'png' && dataUrl == null) {
      await this.fs.copyFile(this.store.mediaPath(plan.id), plan.path, plan.confirmed ? 0 : constants.COPYFILE_EXCL);
    } else {
      const mime = FORMATS[plan.format].mime, prefix = `data:${mime};base64,`;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > MAX_DATA_URL) fail('Invalid image data');
      const body = dataUrl.slice(prefix.length);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) fail('Invalid image data');
      const bytes = Buffer.from(body, 'base64');
      if (!matchesFormat(bytes, plan.format)) fail('The image data does not match the format');
      await this.fs.writeFile(plan.path, bytes, { flag: plan.confirmed ? 'w' : 'wx', mode: 0o644 });
    }
    this.owned.set(path.resolve(plan.path), this.time() + OWN_LIFETIME);
    this.store.setSavedPath(plan.id, plan.path);
    this.tell(this.say('saved', path.basename(plan.path), path.dirname(plan.path)), { file: plan.path });
    return { path: plan.path };
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
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) fail('The temporary folder is not private');
    try {
      const cutoff = Date.now() - TEMP_MAX_AGE; // file mtimes are wall-clock, not the injected clock
      for (const name of await this.fs.readdir(this.tempDirectory)) {
        const file = path.join(this.tempDirectory, name);
        try { const info = await this.fs.lstat(file); if (info.isFile() && info.mtimeMs < cutoff) await this.fs.unlink(file); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    if (saved) return saved;
    const name = fileBaseName(this.settings().output.filenameTemplate, this.now(), { title: item.name || item.title || '' }) + '-' + crypto.randomBytes(3).toString('hex') + '.png';
    const file = path.join(this.tempDirectory, name);
    await this.fs.copyFile(this.store.mediaPath(id), file);
    await this.fs.chmod(file, 0o600);
    return file;
  }

  async cleanup() {
    await this.fs.rm(this.tempDirectory, { recursive: true, force: true });
  }
}

module.exports = { FORMATS, formatFromExtension, matchesFormat, fileBaseName, uniqueOutputPath, defaultSaveFolder, outputText, OutputActions };
