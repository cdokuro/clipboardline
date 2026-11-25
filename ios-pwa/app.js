(() => {
  'use strict';

  const DB_NAME = 'clipboardline_ios_v1';
  const DB_VER = 1;
  const THEMES = ['edna', 'soft', 'neutral'];
  const COLORS = ['#ff5c6c', '#f6b756', '#4ade80', '#60a5fa', '#c084fc', '#ffffff', '#14151c'];

  const state = {
    tab: 'shelves', // shelves | library | settings
    theme: localStorage.getItem('cl_theme') || 'edna',
    items: [],
    folders: JSON.parse(localStorage.getItem('cl_folders') || '[]'),
    searchOpen: false,
    query: '',
    pinnedOnly: false,
    libScope: 'all', // all | pinned | image | text | link | trash
    libFolder: null,
    selectedItemId: null,
    toastTimer: null,
    blobUrls: new Map(),
    editor: null,
  };

  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $editorRoot = document.getElementById('editor-root');
  const $toast = document.getElementById('toast');
  const $photoPicker = document.getElementById('photo-picker');
  const $editorPhotoPicker = document.getElementById('editor-photo-picker');

  // --- Icons ---
  const ICONS = {
    paste: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
    crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    photo: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    theme: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18c1.7 0 3-1.3 3-3 0-.8-.3-1.5-.8-2-.5-.5-.8-1.2-.8-2 0-1.7 1.3-3 3-3h1.6A9 9 0 0 0 12 3Z"/></svg>',
    shelves: '<svg viewBox="0 0 24 24"><path d="M2 7c5 3.5 15 3.5 20 0"/><rect x="5" y="10" width="6" height="9" rx="1"/><rect x="13" y="10" width="6" height="7" rx="1"/></svg>',
    library: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    lens: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M5 9V7a2 2 0 0 1 2-2h2m6 0h2a2 2 0 0 1 2 2v2m0 6v2a2 2 0 0 1-2 2h-2m-6 0H7a2 2 0 0 1-2-2v-2"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 16V3M8 7l4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6Zm3 12v6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    ocr: '<svg viewBox="0 0 24 24"><path d="M4 7V5a2 2 0 0 1 2-2h2m8 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2M7 10h10M7 14h6"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7V5h6l2 2h10v13H3Z"/></svg>',
  };

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg, ms = 2200) {
    $toast.textContent = msg;
    $toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => $toast.classList.add('hidden'), ms);
  }

  function shortTime(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return 'az önce';
    if (d < 3600000) return Math.floor(d / 60000) + ' dk';
    if (d < 86400000) return Math.floor(d / 3600000) + ' sa';
    return new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  }

  function detectUrl(str) {
    const t = str.trim();
    if (!/^https?:\/\/\S+$/i.test(t)) return null;
    try { new URL(t); return t; } catch { return null; }
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  // --- IndexedDB Storage (100% private on user's iPhone) ---
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) {
          db.createObjectStore('items', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbLoadAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readonly');
      const req = tx.objectStore('items').getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.lastCopiedAt || b.createdAt) - (a.lastCopiedAt || a.createdAt));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(item) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function imageUrlFor(item) {
    if (!item.blob) return '';
    if (!state.blobUrls.has(item.id)) {
      state.blobUrls.set(item.id, URL.createObjectURL(item.blob));
    }
    return state.blobUrls.get(item.id);
  }

  function persistFolders() {
    localStorage.setItem('cl_folders', JSON.stringify(state.folders));
  }

  function applyTheme(theme) {
    state.theme = THEMES.includes(theme) ? theme : 'edna';
    localStorage.setItem('cl_theme', state.theme);
    document.body.className = 'theme-' + state.theme;
  }

  async function addTextOrLink(rawText) {
    const text = (rawText || '').trim();
    if (!text) return null;
    const url = detectUrl(text);
    const kind = url ? 'link' : 'text';
    const existing = state.items.find(i => !i.trashedAt && i.kind === kind && (kind === 'link' ? i.url === url : i.text === text));
    const now = Date.now();
    if (existing) {
      existing.lastCopiedAt = now;
      await dbPut(existing);
      state.items = [existing, ...state.items.filter(i => i.id !== existing.id)];
      render();
      return existing;
    }
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : ('id_' + now + '_' + Math.random().toString(36).slice(2)),
      kind,
      text: kind === 'text' ? text : '',
      url: url || '',
      title: kind === 'link' ? hostnameOf(url) : '',
      ocrText: '',
      pinned: false,
      folderId: null,
      tags: [],
      createdAt: now,
      lastCopiedAt: now,
      trashedAt: null
    };
    await dbPut(item);
    state.items.unshift(item);
    render();
    return item;
  }

  async function addImageBlob(blob, width = 0, height = 0, title = '') {
    const now = Date.now();
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : ('id_' + now + '_' + Math.random().toString(36).slice(2)),
      kind: 'image',
      text: '',
      url: '',
      title,
      blob,
      width,
      height,
      ocrText: '',
      pinned: false,
      folderId: null,
      tags: [],
      createdAt: now,
      lastCopiedAt: now,
      trashedAt: null
    };
    await dbPut(item);
    state.items.unshift(item);
    render();
    return item;
  }

  async function copyItem(item) {
    try {
      if (item.kind === 'image' && item.blob) {
        if (navigator.clipboard && window.ClipboardItem) {
          const pngBlob = item.blob.type === 'image/png' ? item.blob : await blobToPng(item.blob);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        } else {
          throw new Error('no-img-clip');
        }
      } else {
        const val = item.kind === 'link' ? item.url : item.text;
        await navigator.clipboard.writeText(val);
      }
      item.lastCopiedAt = Date.now();
      await dbPut(item);
      toast('Panoya kopyalandı');
    } catch {
      if (item.kind !== 'image') {
        const ta = document.createElement('textarea');
        ta.value = item.kind === 'link' ? item.url : item.text;
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('Panoya kopyalandı');
      } else {
        toast('iOS görsel kopyalama için Paylaş butonunu kullanabilirsin');
      }
    }
  }

  async function pasteFromClipboard(openInEditor = false) {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const entries = await navigator.clipboard.read();
        for (const entry of entries) {
          const imgType = entry.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await entry.getType(imgType);
            if (openInEditor) {
              openEditorWithBlob(blob);
            } else {
              const img = await blobToImage(blob);
              await addImageBlob(blob, img.naturalWidth, img.naturalHeight);
              toast('Panodaki görsel ipe asıldı');
            }
            return true;
          }
          if (entry.types.includes('text/plain')) {
            const blob = await entry.getType('text/plain');
            const text = await blob.text();
            if (text.trim()) {
              await addTextOrLink(text);
              toast('Panodaki metin ipe asıldı');
              return true;
            }
          }
        }
      }
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          await addTextOrLink(text);
          toast('Panodaki metin ipe asıldı');
          return true;
        }
      }
      toast('Panoda yeni içerik bulunamadı');
    } catch {
      toast('Safari pano izni istedi — tekrar dokunup "Yapıştır"a izin ver');
    }
    return false;
  }

  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function blobToPng(blob) {
    const img = await blobToImage(blob);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise(res => c.toBlob(b => res(b || blob), 'image/png'));
  }

  // --- Sandboxed Origin:null Google Lens Upload (HTTP 303 direct results!) ---
  async function launchGoogleLens(blob) {
    // Open popup synchronously inside user tap gesture so iOS Safari never blocks it!
    const popup = window.open('/clip/lens-bridge.html', '_blank');
    try {
      const img = await blobToImage(blob);
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const jpgBlob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.88));
      const buf = await jpgBlob.arrayBuffer();

      if (!popup) {
        toast('Pop-up engellendi — Safari ayarlarından izin ver veya Paylaş kullan');
        return;
      }

      let sent = false;
      const sendNow = () => {
        if (sent) return;
        sent = true;
        try { popup.postMessage({ type: 'LENS_IMAGE', bytes: buf, dims: `${w},${h}` }, '*'); } catch {}
      };
      const onMsg = e => {
        if (e.data && e.data.type === 'LENS_READY') {
          window.removeEventListener('message', onMsg);
          sendNow();
        }
      };
      window.addEventListener('message', onMsg);
      setTimeout(() => { window.removeEventListener('message', onMsg); sendNow(); }, 700);
      setTimeout(() => { try { popup.postMessage({ type: 'LENS_IMAGE', bytes: buf, dims: `${w},${h}` }, '*'); } catch {} }, 1300);
    } catch {
      if (popup) popup.close();
      toast('Google Lens gönderimi başarısız oldu');
    }
  }

  async function shareItemNative(item) {
    try {
      if (!navigator.share) { toast('Bu tarayıcı yerel paylaşımı desteklemiyor'); return; }
      if (item.kind === 'image' && item.blob) {
        const file = new File([item.blob], 'clipboardline.png', { type: item.blob.type || 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'ClipBoardLine' });
          return;
        }
      }
      await navigator.share({ text: item.kind === 'link' ? item.url : item.text, title: item.title || 'ClipBoardLine' });
    } catch {}
  }

  // --- Client-Side OCR (Lazy-loaded Tesseract.js only when user taps OCR) ---
  let tesseractPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractPromise) {
      tesseractPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = () => resolve(window.Tesseract);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return tesseractPromise;
  }

  async function runOcrOnBlob(blob) {
    toast('OCR metin taranıyor (TR + EN)…', 6000);
    try {
      const T = await loadTesseract();
      const res = await T.recognize(blob, 'tur+eng');
      return (res?.data?.text || '').trim();
    } catch {
      toast('OCR motoru yüklenemedi (internet bağlantısı gerekli)');
      return '';
    }
  }

  // --- Card HTML ---
  function cardHtml(item, idx, showPin = true) {
    const tilt = showPin ? ((((item.id.charCodeAt(0) + idx * 7) % 5) - 2) * 0.65).toFixed(2) : '0';
    let inner = '';
    if (item.kind === 'image') {
      const src = imageUrlFor(item);
      inner = `<div class="card-img-box">${src ? `<img src="${src}" alt="" loading="lazy">` : ''}${item.ocrText ? '<span class="card-ocr-tag">OCR</span>' : ''}${item.pinned ? '<span class="card-pin-dot">★</span>' : ''}</div><div class="card-foot">${esc(item.title || (item.width ? `${item.width}×${item.height}` : shortTime(item.lastCopiedAt)))}</div>`;
    } else if (item.kind === 'link') {
      const host = hostnameOf(item.url);
      inner = `<div class="card-text-body"><div class="card-meta"><span class="link-chip">${esc(host)}</span>${item.pinned ? '<span style="color:var(--gold)">★</span>' : ''}</div><div class="link-title">${esc(item.title || host)}</div><div class="link-url">${esc(item.url)}</div></div>`;
    } else {
      inner = `<div class="card-text-body"><div class="card-meta"><span>${esc(item.title || shortTime(item.lastCopiedAt))}</span>${item.pinned ? '<span style="color:var(--gold)">★</span>' : ''}</div><div class="card-snippet">${esc(item.text)}</div></div>`;
    }
    return `<div class="clip-card-wrap" style="--tilt:${tilt}deg">${showPin ? '<div class="clothespin"></div>' : ''}<div class="clip-card ${item.pinned ? 'pinned' : ''}" data-card-id="${esc(item.id)}">${inner}</div></div>`;
  }

  function wireSvg() {
    return '<svg class="wire-svg" viewBox="0 0 400 16" preserveAspectRatio="none"><path d="M0,3 Q200,18 400,3"/></svg>';
  }

  function filterItems(list, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(i =>
      (i.text || '').toLowerCase().includes(q) ||
      (i.url || '').toLowerCase().includes(q) ||
      (i.title || '').toLowerCase().includes(q) ||
      (i.ocrText || '').toLowerCase().includes(q) ||
      (i.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  function renderShelves() {
    const active = filterItems(state.items.filter(i => !i.trashedAt && (!state.pinnedOnly || i.pinned)), state.query);
    const images = active.filter(i => i.kind === 'image');
    const texts = active.filter(i => i.kind === 'text');
    const links = active.filter(i => i.kind === 'link');

    const row = (label, color, list, emptyMsg) => `
      <section class="shelf-section">
        <div class="shelf-head">
          <span class="dot" style="background:${color}"></span>
          <h2>${label}</h2>
          <span class="badge">${list.length}</span>
          ${list.length ? '<span class="hint">Dokun: Kopyala · Basılı tut: Detay</span>' : ''}
        </div>
        <div class="wire-wrap">
          ${wireSvg()}
          ${list.length ? `<div class="shelf-track">${list.map((it, idx) => cardHtml(it, idx, true)).join('')}</div>` : `<div class="empty-shelf">${emptyMsg}</div>`}
        </div>
      </section>`;

    return `
      <header class="topbar">
        <div class="topbar-title">
          <h1>ClipBoardLine</h1>
          <small>${active.length} öğe ipte asılı</small>
        </div>
        <button class="icon-btn ${state.searchOpen ? 'active' : ''}" data-act="toggle-search" aria-label="Ara">${ICONS.search}</button>
        <button class="icon-btn" data-act="paste-clip" aria-label="Panoyu Yapıştır" style="color:var(--success)">${ICONS.paste}</button>
        <button class="icon-btn" data-act="cycle-theme" aria-label="Tema" style="color:var(--gold)">${ICONS.theme}</button>
      </header>
      ${state.searchOpen ? `<div class="search-wrap"><input id="shelf-search" class="search-input" value="${esc(state.query)}" placeholder="Metin, link, OCR veya etiket ara…"></div>` : ''}
      <div class="quick-row">
        <button class="pill-btn primary" data-act="smart-snip">${ICONS.crop} Alıntı / Kırp</button>
        <button class="pill-btn success" data-act="paste-clip">${ICONS.paste} Panodan As</button>
        <button class="pill-btn" data-act="pick-edit">${ICONS.photo} Galeriden Kırp</button>
        <button class="pill-btn" data-act="new-note">${ICONS.plus} Not</button>
        <button class="pill-btn ${state.pinnedOnly ? 'active' : ''}" data-act="toggle-pin-filter">${ICONS.pin} Sabit</button>
      </div>
      ${row('Görseller', 'var(--img-accent)', images, 'Henüz görsel yok — panodan yapıştır veya Fotoğraflar’dan seç.')}
      ${row('Metinler', 'var(--txt-accent)', texts, 'Henüz metin yok — panodan yapıştır veya yeni not ekle.')}
      ${row('Linkler', 'var(--lnk-accent)', links, 'Henüz link yok — kopyaladığın bağlantılar otomatik buraya düşer.')}
    `;
  }

  function renderLibrary() {
    let base = state.items.filter(i => state.libScope === 'trash' ? !!i.trashedAt : !i.trashedAt);
    if (state.libFolder) base = base.filter(i => i.folderId === state.libFolder);
    else if (state.libScope === 'pinned') base = base.filter(i => i.pinned);
    else if (['image', 'text', 'link'].includes(state.libScope)) base = base.filter(i => i.kind === state.libScope);
    const list = filterItems(base, state.query);

    const scopes = [
      ['all', 'Tümü'], ['pinned', 'Sabitlenenler'], ['image', 'Görseller'],
      ['text', 'Metinler'], ['link', 'Linkler'], ['trash', 'Çöp']
    ];

    return `
      <header class="topbar">
        <div class="topbar-title">
          <h1>Kütüphane</h1>
          <small>${list.length} öğe</small>
        </div>
        ${state.libScope === 'trash' && list.length ? `<button class="icon-btn" data-act="empty-trash" style="color:var(--danger)" aria-label="Çöpü Boşalt">${ICONS.trash}</button>` : ''}
        <button class="icon-btn" data-act="new-folder" style="color:var(--accent)" aria-label="Yeni Klasör">${ICONS.folder}</button>
      </header>
      <div class="search-wrap"><input id="lib-search" class="search-input" value="${esc(state.query)}" placeholder="Kütüphanede ara (OCR metinleri dahil)…"></div>
      <div class="quick-row">
        ${scopes.map(([k, lbl]) => `<button class="pill-btn ${!state.libFolder && state.libScope === k ? 'active' : ''}" data-scope="${k}">${lbl}</button>`).join('')}
        ${state.folders.map(f => `<button class="pill-btn ${state.libFolder === f.id ? 'active' : ''}" data-folder="${esc(f.id)}">${ICONS.folder} ${esc(f.name)}</button>`).join('')}
      </div>
      ${list.length ? `<div class="lib-grid">${list.map((it, idx) => cardHtml(it, idx, false)).join('')}</div>` : '<div class="empty-shelf" style="margin-top:16px">Bu görünümde öğe yok.</div>'}
    `;
  }

  function renderSettings() {
    const shortcutUrl = location.origin + '/clip/?action=paste-edit';
    return `
      <header class="topbar">
        <div class="topbar-title">
          <h1>Ayarlar & iPhone Kurulumu</h1>
          <small>ClipBoardLine iPhone PWA v1.0</small>
        </div>
      </header>
      <div class="settings-wrap">
        <div class="set-card">
          <h3>Tema</h3>
          <div class="quick-row" style="padding:0">
            <button class="pill-btn ${state.theme === 'edna' ? 'active' : ''}" data-theme="edna">Edna Dark</button>
            <button class="pill-btn ${state.theme === 'soft' ? 'active' : ''}" data-theme="soft">Soft Dark</button>
            <button class="pill-btn ${state.theme === 'neutral' ? 'active' : ''}" data-theme="neutral">Neutral</button>
          </div>
        </div>

        <div class="set-card">
          <h3>1. iPhone Ana Ekrana Uygulama Olarak Ekle</h3>
          <ol>
            <li>Bu sayfayı iPhone <b>Safari</b> tarayıcısında aç.</li>
            <li>Alt bardaki <b>Paylaş (yukarı ok)</b> simgesine dokun.</li>
            <li><b>"Ana Ekrana Ekle"</b> → <b>Ekle</b> dediğinde normal uygulama ikonu gibi tam ekran ve çevrimdışı çalışır.</li>
          </ol>
          <p style="margin-top:8px">Tüm görseller ve notlar yalnızca kendi iPhone’unun yerel hafızasında (IndexedDB) saklanır, sunucuya yüklenmez.</p>
        </div>

        <div class="set-card">
          <h3>2. iPhone 13 Pro — Arka Çift Dokunma (Sıfır Menü, Tak Diye Kırp & Lens!)</h3>
          <p>iPhone’un arkasına 2 kez dokununca hiçbir menü çıkmadan ekran görüntüsünü doğrudan Kırp & Google Lens ekranında açmak için:</p>
          <ol>
            <li><b>Kestirmeler (Shortcuts)</b> uygulamasında yeni kestirme oluştur (Ad: <b>ClipBoardLine Alıntı</b>).</li>
            <li><b>Ekran Resmi Çek</b> (Take Screenshot) eylemini ekle.</li>
            <li><b>Görüntüyü Yeniden Boyutlandır</b> → Genişlik <b>1080</b> (Yükseklik: Otomatik).</li>
            <li><b>Görüntüyü Dönüştür</b> → <b>JPEG</b> (Kalite: ~%70).</li>
            <li><b>Base64 Kodla</b> (Satır Sonu: <b>Yok</b>).</li>
            <li><b>URL’leri Aç</b> eylemini ekleyip şunu yaz (sonuna Base64 değişkenini ekle):
              <span class="code-pill">${esc(location.origin + '/clip/#img=')}[Base64 Kodlanmış Metin]</span>
            </li>
            <li><b>Ayarlar → Erişilebilirlik → Dokunma → Arkaya Dokun → Çift Dokunma</b> → <b>ClipBoardLine Alıntı</b> seç!</li>
          </ol>
          <p style="margin-top:8px"><b>Daha kısa 3 adımlı alternatif:</b> <i>Ekran Resmi Çek → Panoya Kopyala → URL Aç:</i> <span class="code-pill">${esc(shortcutUrl)}</span></p>
          <div class="quick-row" style="padding:8px 0 0">
            <button class="pill-btn primary" data-act="copy-hash-url">${ICONS.copy} #img= Adresini Kopyala</button>
            <button class="pill-btn" data-act="copy-shortcut-url">${ICONS.copy} Kısa Adresi Kopyala</button>
          </div>
        </div>

        <div class="set-card">
          <h3>Veri & Depolama</h3>
          <p>Kayıtlı toplam <b>${state.items.length}</b> öğe (tamamen iPhone içinde yerel depolama).</p>
        </div>
      </div>
    `;
  }

  function render() {
    const scrollEl = $app.querySelector('.main-scroll');
    const prevScroll = scrollEl ? scrollEl.scrollTop : 0;
    const activeElId = document.activeElement?.id || '';

    const body = state.tab === 'shelves' ? renderShelves() : state.tab === 'library' ? renderLibrary() : renderSettings();
    $app.innerHTML = `
      <main class="main-scroll">${body}</main>
      <nav class="tabbar">
        <button class="tab-btn ${state.tab === 'shelves' ? 'active' : ''}" data-tab="shelves">${ICONS.shelves}<span>İp Askısı</span></button>
        <button class="tab-btn ${state.tab === 'library' ? 'active' : ''}" data-tab="library">${ICONS.library}<span>Kütüphane</span></button>
        <button class="tab-btn ${state.tab === 'settings' ? 'active' : ''}" data-tab="settings">${ICONS.settings}<span>Ayarlar</span></button>
      </nav>
    `;

    const newScroll = $app.querySelector('.main-scroll');
    if (newScroll) newScroll.scrollTop = prevScroll;
    if (activeElId) {
      const inp = document.getElementById(activeElId);
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    bindEvents();
  }

  // --- Detail Bottom Sheet ---
  function openItemSheet(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    state.selectedItemId = id;

    let preview = '';
    if (item.kind === 'image') {
      preview = `<img class="sheet-preview-img" src="${imageUrlFor(item)}" alt="">`;
    } else if (item.kind === 'link') {
      preview = `<div class="sheet-preview-txt"><b>${esc(item.title || hostnameOf(item.url))}</b><br><a href="${esc(item.url)}" target="_blank" rel="noopener" style="color:var(--lnk-accent)">${esc(item.url)}</a></div>`;
    } else {
      preview = `<div class="sheet-preview-txt">${esc(item.text)}</div>`;
    }

    $modal.innerHTML = `
      <div class="sheet-backdrop" id="sheet-backdrop">
        <div class="sheet-panel">
          <div class="sheet-handle"></div>
          ${preview}
          <div class="quick-row" style="padding:0">
            <button class="pill-btn primary" data-sact="copy">${ICONS.copy} Kopyala</button>
            <button class="pill-btn ${item.pinned ? 'active' : ''}" data-sact="pin">${ICONS.pin} ${item.pinned ? 'Sabiti Kaldır' : 'Sabitle'}</button>
            <button class="pill-btn" data-sact="share">${ICONS.share} Paylaş</button>
            ${item.trashedAt
              ? `<button class="pill-btn success" data-sact="restore">Geri Yükle</button><button class="pill-btn danger" data-sact="delete-forever">Kalıcı Sil</button>`
              : `<button class="pill-btn danger" data-sact="trash">${ICONS.trash} Sil</button>`}
          </div>
          ${item.kind === 'image' ? `
            <div class="quick-row" style="padding:0">
              <button class="pill-btn lens" data-sact="lens">${ICONS.lens} Google Lens</button>
              <button class="pill-btn success" data-sact="ocr">${ICONS.ocr} OCR Metin</button>
              <button class="pill-btn" data-sact="edit">${ICONS.crop} Kırp & İşaretle</button>
            </div>
          ` : ''}
          ${item.ocrText ? `
            <div class="set-card" style="padding:11px;border-color:rgba(82,209,150,0.4)">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <b style="color:var(--success);font-size:12px">OCR Metni</b>
                <button class="pill-btn" style="padding:4px 9px;font-size:11.5px" data-sact="copy-ocr">Kopyala</button>
              </div>
              <div style="font-size:13px;line-height:1.45;white-space:pre-wrap">${esc(item.ocrText)}</div>
            </div>
          ` : ''}
          <input class="field-input" id="sheet-title" value="${esc(item.title)}" placeholder="Başlık / İsim">
          <input class="field-input" id="sheet-tags" value="${esc((item.tags || []).join(', '))}" placeholder="Etiketler (virgülle ayır)">
          ${state.folders.length ? `
            <div class="quick-row" style="padding:0">
              <button class="pill-btn ${!item.folderId ? 'active' : ''}" data-sfolder="">Klasörsüz</button>
              ${state.folders.map(f => `<button class="pill-btn ${item.folderId === f.id ? 'active' : ''}" data-sfolder="${esc(f.id)}">${ICONS.folder} ${esc(f.name)}</button>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    const close = () => { $modal.innerHTML = ''; state.selectedItemId = null; };
    document.getElementById('sheet-backdrop').addEventListener('click', e => {
      if (e.target.id === 'sheet-backdrop') close();
    });
    document.getElementById('sheet-title').addEventListener('change', async e => {
      item.title = e.target.value.trim(); await dbPut(item); render();
    });
    document.getElementById('sheet-tags').addEventListener('change', async e => {
      item.tags = e.target.value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
      await dbPut(item); render();
    });
    $modal.querySelectorAll('[data-sfolder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        item.folderId = btn.dataset.sfolder || null;
        await dbPut(item); render(); openItemSheet(item.id);
      });
    });
    $modal.querySelectorAll('[data-sact]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.sact;
        if (act === 'copy') { await copyItem(item); close(); }
        else if (act === 'pin') { item.pinned = !item.pinned; await dbPut(item); render(); openItemSheet(item.id); }
        else if (act === 'share') { await shareItemNative(item); }
        else if (act === 'trash') { item.trashedAt = Date.now(); await dbPut(item); render(); close(); toast('Çöpe taşındı'); }
        else if (act === 'restore') { item.trashedAt = null; await dbPut(item); render(); close(); toast('Geri yüklendi'); }
        else if (act === 'delete-forever') { await dbDelete(item.id); state.items = state.items.filter(i => i.id !== item.id); render(); close(); toast('Kalıcı silindi'); }
        else if (act === 'lens' && item.blob) { close(); await launchGoogleLens(item.blob); }
        else if (act === 'edit' && item.blob) { close(); openEditorWithBlob(item.blob); }
        else if (act === 'copy-ocr') { await navigator.clipboard.writeText(item.ocrText); toast('OCR metni kopyalandı'); }
        else if (act === 'ocr' && item.blob) {
          const text = await runOcrOnBlob(item.blob);
          if (text) { item.ocrText = text; await dbPut(item); render(); openItemSheet(item.id); toast('OCR tamamlandı'); }
          else toast('Görselde metin bulunamadı');
        }
      });
    });
  }

  function openNewNoteModal() {
    $modal.innerHTML = `
      <div class="sheet-backdrop" id="note-backdrop">
        <div class="sheet-panel">
          <div class="sheet-handle"></div>
          <h3 style="margin:0;font-size:16px">Yeni Not veya Link</h3>
          <textarea class="field-textarea" id="note-input" placeholder="Metin veya URL yaz veya yapıştır…"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="pill-btn" id="note-cancel">İptal</button>
            <button class="pill-btn primary" id="note-save">İpe As</button>
          </div>
        </div>
      </div>`;
    const inp = document.getElementById('note-input');
    inp.focus();
    const close = () => { $modal.innerHTML = ''; };
    document.getElementById('note-backdrop').addEventListener('click', e => { if (e.target.id === 'note-backdrop') close(); });
    document.getElementById('note-cancel').addEventListener('click', close);
    document.getElementById('note-save').addEventListener('click', async () => {
      if (inp.value.trim()) { await addTextOrLink(inp.value); toast('İpe asıldı'); }
      close();
    });
  }

  function openNewFolderModal() {
    $modal.innerHTML = `
      <div class="sheet-backdrop" id="fld-backdrop">
        <div class="sheet-panel">
          <div class="sheet-handle"></div>
          <h3 style="margin:0;font-size:16px">Yeni Klasör</h3>
          <input class="field-input" id="fld-input" placeholder="Klasör adı">
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="pill-btn" id="fld-cancel">İptal</button>
            <button class="pill-btn primary" id="fld-save">Oluştur</button>
          </div>
        </div>
      </div>`;
    const inp = document.getElementById('fld-input');
    inp.focus();
    const close = () => { $modal.innerHTML = ''; };
    document.getElementById('fld-backdrop').addEventListener('click', e => { if (e.target.id === 'fld-backdrop') close(); });
    document.getElementById('fld-cancel').addEventListener('click', close);
    document.getElementById('fld-save').addEventListener('click', () => {
      const name = inp.value.trim();
      if (name) {
        state.folders.push({ id: 'f_' + Date.now(), name });
        persistFolders();
        render();
        toast('Klasör oluşturuldu');
      }
      close();
    });
  }

  // --- Fullscreen Touch Crop (8-Handle Resizable) & Markup Studio ---
  async function openEditorWithBlob(blob) {
    const img = await blobToImage(blob);
    const ed = {
      img,
      tool: 'crop', // crop | pen | hi | arrow | rect | ellipse | pixel | num
      color: COLORS[0],
      stroke: 7,
      crop: null, // {x, y, w, h} in image coords
      anns: [],
      redo: [],
      draft: null,
      numSeq: 1,
      scale: 1, ox: 0, oy: 0,
      drag: null
    };
    state.editor = ed;
    renderEditorShell();
    $editorRoot.classList.remove('hidden');
    requestAnimationFrame(() => drawEditor());
  }

  function closeEditor() {
    state.editor = null;
    $editorRoot.classList.add('hidden');
    $editorRoot.innerHTML = '';
  }

  function renderEditorShell() {
    const ed = state.editor;
    if (!ed) return;
    const tools = [
      ['crop', 'Kırp'], ['pen', 'Kalem'], ['hi', 'Fosforlu'], ['arrow', 'Ok'],
      ['rect', 'Kutu'], ['ellipse', 'Daire'], ['pixel', 'Gizle'], ['num', 'Sayı']
    ];
    const cw = ed.crop ? Math.round(ed.crop.w) : ed.img.naturalWidth;
    const ch = ed.crop ? Math.round(ed.crop.h) : ed.img.naturalHeight;

    $editorRoot.innerHTML = `
      <div class="editor-canvas-wrap"><canvas id="editor-canvas"></canvas></div>
      <div class="ed-bar top">
        <div class="ed-row">
          ${tools.map(([k, lbl]) => `<button class="tool-chip ${ed.tool === k ? 'active' : ''}" data-edtool="${k}">${lbl}</button>`).join('')}
        </div>
        <div class="ed-row">
          ${COLORS.map(c => `<button class="color-dot ${ed.color === c ? 'active' : ''}" data-edcolor="${c}" style="background:${c}"></button>`).join('')}
          <button class="tool-chip" data-edact="undo" ${ed.anns.length ? '' : 'disabled style="opacity:.35"'}>↶</button>
          <button class="tool-chip" data-edact="redo" ${ed.redo.length ? '' : 'disabled style="opacity:.35"'}>↷</button>
          <span class="size-badge" id="ed-size-badge">${cw}×${ch}</span>
        </div>
      </div>
      <div class="ed-bar bottom">
        <button class="pill-btn danger" data-edact="cancel" style="padding:8px 10px">${ICONS.close}</button>
        ${ed.crop ? '<button class="pill-btn" data-edact="full" style="padding:8px 10px">Tam</button>' : ''}
        <button class="pill-btn lens" data-edact="lens">${ICONS.lens} Google Lens</button>
        <button class="pill-btn success" data-edact="ocr">${ICONS.ocr} OCR</button>
        <button class="pill-btn" data-edact="share" style="padding:8px 10px">${ICONS.share}</button>
        <button class="pill-btn primary" data-edact="save">${ICONS.check} Kaydet</button>
      </div>
    `;

    $editorRoot.querySelectorAll('[data-edtool]').forEach(b => b.addEventListener('click', () => {
      ed.tool = b.dataset.edtool; renderEditorShell(); drawEditor();
    }));
    $editorRoot.querySelectorAll('[data-edcolor]').forEach(b => b.addEventListener('click', () => {
      ed.color = b.dataset.edcolor; renderEditorShell(); drawEditor();
    }));
    $editorRoot.querySelectorAll('[data-edact]').forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.edact;
      if (a === 'cancel') closeEditor();
      else if (a === 'full') { ed.crop = null; renderEditorShell(); drawEditor(); }
      else if (a === 'undo' && ed.anns.length) { ed.redo.push(ed.anns.pop()); renderEditorShell(); drawEditor(); }
      else if (a === 'redo' && ed.redo.length) { ed.anns.push(ed.redo.pop()); renderEditorShell(); drawEditor(); }
      else if (a === 'save') {
        const out = await exportEditorBlob(ed);
        const added = await addImageBlob(out.blob, out.w, out.h);
        if (added) await copyItem(added);
        closeEditor();
        toast('İpe kaydedildi ve kopyalandı');
      } else if (a === 'lens') {
        const out = await exportEditorBlob(ed);
        await addImageBlob(out.blob, out.w, out.h);
        closeEditor();
        await launchGoogleLens(out.blob);
      } else if (a === 'ocr') {
        const out = await exportEditorBlob(ed);
        const text = await runOcrOnBlob(out.blob);
        if (text) {
          await navigator.clipboard.writeText(text).catch(() => {});
          alert('OCR Metni (panoya kopyalandı):\n\n' + text);
        } else toast('Görselde metin bulunamadı');
      } else if (a === 'share') {
        const out = await exportEditorBlob(ed);
        await shareItemNative({ kind: 'image', blob: out.blob });
      }
    }));

    bindEditorCanvas();
  }

  function bindEditorCanvas() {
    const canvas = document.getElementById('editor-canvas');
    const ed = state.editor;
    if (!canvas || !ed) return;

    const toImg = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const sx = clientX - r.left, sy = clientY - r.top;
      return {
        sx, sy,
        x: Math.max(0, Math.min(ed.img.naturalWidth, (sx - ed.ox) / ed.scale)),
        y: Math.max(0, Math.min(ed.img.naturalHeight, (sy - ed.oy) / ed.scale))
      };
    };
    const toScr = (ix, iy) => ({ x: ed.ox + ix * ed.scale, y: ed.oy + iy * ed.scale });

    function hitCrop(sx, sy, c) {
      const tl = toScr(c.x, c.y), br = toScr(c.x + c.w, c.y + c.h);
      const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
      const cr = 34, er = 26;
      if (dist(sx, sy, tl.x, tl.y) <= cr) return 'tl';
      if (dist(sx, sy, br.x, tl.y) <= cr) return 'tr';
      if (dist(sx, sy, tl.x, br.y) <= cr) return 'bl';
      if (dist(sx, sy, br.x, br.y) <= cr) return 'br';
      const inY = sy >= tl.y - er && sy <= br.y + er;
      const inX = sx >= tl.x - er && sx <= br.x + er;
      if (inY && Math.abs(sx - tl.x) <= er) return 'l';
      if (inY && Math.abs(sx - br.x) <= er) return 'r';
      if (inX && Math.abs(sy - tl.y) <= er) return 't';
      if (inX && Math.abs(sy - br.y) <= er) return 'b';
      if (sx >= tl.x && sx <= br.x && sy >= tl.y && sy <= br.y) return 'move';
      return 'new';
    }

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      const p = toImg(e.clientX, e.clientY);
      if (ed.tool === 'num') {
        ed.anns.push({ kind: 'num', x: p.x, y: p.y, n: ed.numSeq++, color: ed.color });
        ed.redo = [];
        renderEditorShell(); drawEditor();
        return;
      }
      if (ed.tool === 'crop') {
        const mode = (ed.crop && ed.crop.w >= 20 && ed.crop.h >= 20) ? hitCrop(p.sx, p.sy, ed.crop) : 'new';
        ed.drag = { mode, start: p, orig: ed.crop ? { ...ed.crop } : null };
        if (mode === 'new') ed.crop = { x: p.x, y: p.y, w: 0, h: 0 };
      } else if (ed.tool === 'pen' || ed.tool === 'hi') {
        ed.draft = { kind: ed.tool, points: [{ x: p.x, y: p.y }], color: ed.color, stroke: ed.tool === 'hi' ? ed.stroke * 3 : ed.stroke };
        ed.drag = { mode: 'draw' };
      } else {
        ed.draft = { kind: ed.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: ed.color, stroke: ed.stroke };
        ed.drag = { mode: 'draw' };
      }
      drawEditor();
    });

    canvas.addEventListener('pointermove', e => {
      if (!ed.drag) return;
      const p = toImg(e.clientX, e.clientY);
      const iw = ed.img.naturalWidth, ih = ed.img.naturalHeight, minS = 24;
      if (ed.tool === 'crop') {
        const { mode, start, orig } = ed.drag;
        if (mode === 'new' || !orig) {
          ed.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        } else if (mode === 'move') {
          const nx = Math.max(0, Math.min(iw - orig.w, orig.x + (p.x - start.x)));
          const ny = Math.max(0, Math.min(ih - orig.h, orig.y + (p.y - start.y)));
          ed.crop = { x: nx, y: ny, w: orig.w, h: orig.h };
        } else {
          let l = orig.x, t = orig.y, r = orig.x + orig.w, b = orig.y + orig.h;
          if (mode.includes('l')) l = Math.max(0, Math.min(r - minS, p.x));
          if (mode.includes('r')) r = Math.min(iw, Math.max(l + minS, p.x));
          if (mode.includes('t')) t = Math.max(0, Math.min(b - minS, p.y));
          if (mode.includes('b')) b = Math.min(ih, Math.max(t + minS, p.y));
          ed.crop = { x: l, y: t, w: r - l, h: b - t };
        }
        const badge = document.getElementById('ed-size-badge');
        if (badge && ed.crop) badge.textContent = `${Math.round(ed.crop.w)}×${Math.round(ed.crop.h)}`;
      } else if (ed.draft) {
        if (ed.draft.points) ed.draft.points.push({ x: p.x, y: p.y });
        else { ed.draft.x2 = p.x; ed.draft.y2 = p.y; }
      }
      drawEditor();
    });

    const endDrag = () => {
      if (!ed.drag) return;
      if (ed.tool === 'crop') {
        if (ed.crop && (ed.crop.w < 16 || ed.crop.h < 16)) ed.crop = null;
        renderEditorShell();
      } else if (ed.draft) {
        ed.anns.push(ed.draft);
        ed.redo = [];
        ed.draft = null;
        renderEditorShell();
      }
      ed.drag = null;
      drawEditor();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  function drawAnnotations(ctx, anns, baseImg, scale = 1, ox = 0, oy = 0, exportMode = false) {
    const tx = x => ox + x * scale, ty = y => oy + y * scale;
    for (const a of anns) {
      ctx.save();
      if (a.kind === 'pen' || a.kind === 'hi') {
        if (a.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(tx(a.points[0].x), ty(a.points[0].y));
          for (let i = 1; i < a.points.length; i++) ctx.lineTo(tx(a.points[i].x), ty(a.points[i].y));
          ctx.strokeStyle = a.color;
          ctx.globalAlpha = a.kind === 'hi' ? 0.36 : 1;
          ctx.lineWidth = a.stroke * scale;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.stroke();
        }
      } else if (a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'pixel') {
        const l = Math.min(a.x1, a.x2), t = Math.min(a.y1, a.y2), w = Math.abs(a.x2 - a.x1), h = Math.abs(a.y2 - a.y1);
        if (a.kind === 'rect') {
          ctx.strokeStyle = a.color; ctx.lineWidth = a.stroke * scale;
          ctx.strokeRect(tx(l), ty(t), w * scale, h * scale);
        } else if (a.kind === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(tx(l + w / 2), ty(t + h / 2), Math.max(1, (w * scale) / 2), Math.max(1, (h * scale) / 2), 0, 0, Math.PI * 2);
          ctx.strokeStyle = a.color; ctx.lineWidth = a.stroke * scale; ctx.stroke();
        } else if (a.kind === 'pixel') {
          if (exportMode && w >= 4 && h >= 4) {
            const block = Math.max(12, Math.floor(Math.min(w, h) / 10));
            const tw = Math.max(1, Math.floor(w / block)), th = Math.max(1, Math.floor(h / block));
            const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
            tmp.getContext('2d').drawImage(baseImg, l, t, w, h, 0, 0, tw, th);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmp, 0, 0, tw, th, l, t, w, h);
          } else {
            ctx.fillStyle = 'rgba(24,27,36,0.82)'; ctx.fillRect(tx(l), ty(t), w * scale, h * scale);
            ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5; ctx.strokeRect(tx(l), ty(t), w * scale, h * scale);
          }
        }
      } else if (a.kind === 'arrow') {
        const x1 = tx(a.x1), y1 = ty(a.y1), x2 = tx(a.x2), y2 = ty(a.y2);
        const sw = a.stroke * scale;
        ctx.strokeStyle = a.color; ctx.lineWidth = sw; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const ang = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(20, sw * 4.2);
        ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang - Math.PI / 6), y2 - hl * Math.sin(ang - Math.PI / 6));
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang + Math.PI / 6), y2 - hl * Math.sin(ang + Math.PI / 6));
        ctx.stroke();
      } else if (a.kind === 'num') {
        const cx = tx(a.x), cy = ty(a.y), r = 24 * Math.max(0.75, scale);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = a.color; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(r * 1.1)}px -apple-system,sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(a.n), cx, cy + 1);
      }
      ctx.restore();
    }
  }

  function drawEditor() {
    const canvas = document.getElementById('editor-canvas');
    const ed = state.editor;
    if (!canvas || !ed) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.max(1, Math.round(rect.width)), ch = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    const iw = ed.img.naturalWidth, ih = ed.img.naturalHeight;
    ed.scale = Math.min(cw / iw, ch / ih);
    const dw = iw * ed.scale, dh = ih * ed.scale;
    ed.ox = (cw - dw) / 2; ed.oy = (ch - dh) / 2;

    ctx.drawImage(ed.img, ed.ox, ed.oy, dw, dh);
    const all = ed.draft ? [...ed.anns, ed.draft] : ed.anns;
    drawAnnotations(ctx, all, ed.img, ed.scale, ed.ox, ed.oy, false);

    if (ed.crop && ed.crop.w >= 4 && ed.crop.h >= 4) {
      const x = ed.ox + ed.crop.x * ed.scale, y = ed.oy + ed.crop.y * ed.scale;
      const w = ed.crop.w * ed.scale, h = ed.crop.h * ed.scale;
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      ctx.fillRect(0, 0, cw, y);
      ctx.fillRect(0, y + h, cw, ch - (y + h));
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, cw - (x + w), h);

      if (w > 64 && h > 64) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w / 3, y); ctx.lineTo(x + w / 3, y + h);
        ctx.moveTo(x + 2 * w / 3, y); ctx.lineTo(x + 2 * w / 3, y + h);
        ctx.moveTo(x, y + h / 3); ctx.lineTo(x + w, y + h / 3);
        ctx.moveTo(x, y + 2 * h / 3); ctx.lineTo(x + w, y + 2 * h / 3);
        ctx.stroke();
      }
      ctx.strokeStyle = '#7c9cff'; ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      // 4 Edge bars
      const bl = Math.max(14, Math.min(34, Math.min(w, h) * 0.32));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - bl / 2, y); ctx.lineTo(x + w / 2 + bl / 2, y);
      ctx.moveTo(x + w / 2 - bl / 2, y + h); ctx.lineTo(x + w / 2 + bl / 2, y + h);
      ctx.moveTo(x, y + h / 2 - bl / 2); ctx.lineTo(x, y + h / 2 + bl / 2);
      ctx.moveTo(x + w, y + h / 2 - bl / 2); ctx.lineTo(x + w, y + h / 2 + bl / 2);
      ctx.stroke();

      // 4 Corner handles
      for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = '#7c9cff'; ctx.lineWidth = 2.5; ctx.stroke();
      }
    }
  }

  async function exportEditorBlob(ed) {
    const iw = ed.img.naturalWidth, ih = ed.img.naturalHeight;
    const full = document.createElement('canvas');
    full.width = iw; full.height = ih;
    const ctx = full.getContext('2d');
    ctx.drawImage(ed.img, 0, 0, iw, ih);
    drawAnnotations(ctx, ed.anns, ed.img, 1, 0, 0, true);

    let out = full, w = iw, h = ih;
    if (ed.crop && ed.crop.w >= 16 && ed.crop.h >= 16) {
      const rx = Math.max(0, Math.round(ed.crop.x)), ry = Math.max(0, Math.round(ed.crop.y));
      w = Math.max(1, Math.min(iw - rx, Math.round(ed.crop.w)));
      h = Math.max(1, Math.min(ih - ry, Math.round(ed.crop.h)));
      out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d').drawImage(full, rx, ry, w, h, 0, 0, w, h);
    }
    const blob = await new Promise(res => out.toBlob(res, 'image/png'));
    return { blob, w, h };
  }

  // --- Event Binding ---
  function bindEvents() {
    $app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      state.tab = b.dataset.tab; render();
    }));
    $app.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
      applyTheme(b.dataset.theme); render();
    }));
    $app.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      state.libFolder = null; state.libScope = b.dataset.scope; render();
    }));
    $app.querySelectorAll('[data-folder]').forEach(b => b.addEventListener('click', () => {
      state.libFolder = b.dataset.folder; render();
    }));

    const sInp = document.getElementById('shelf-search') || document.getElementById('lib-search');
    if (sInp) sInp.addEventListener('input', e => { state.query = e.target.value; render(); });

    $app.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.act;
      if (a === 'toggle-search') { state.searchOpen = !state.searchOpen; if (!state.searchOpen) state.query = ''; render(); }
      else if (a === 'cycle-theme') { applyTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]); render(); }
      else if (a === 'smart-snip') { await handleSmartSnip(); }
      else if (a === 'paste-clip') { await pasteFromClipboard(false); }
      else if (a === 'paste-edit') { await pasteFromClipboard(true); }
      else if (a === 'new-note') { openNewNoteModal(); }
      else if (a === 'new-folder') { openNewFolderModal(); }
      else if (a === 'pick-photo') { $photoPicker.click(); }
      else if (a === 'pick-edit') { $editorPhotoPicker.click(); }
      else if (a === 'toggle-pin-filter') { state.pinnedOnly = !state.pinnedOnly; render(); }
      else if (a === 'empty-trash') {
        const trashed = state.items.filter(i => i.trashedAt);
        for (const t of trashed) await dbDelete(t.id);
        state.items = state.items.filter(i => !i.trashedAt);
        render(); toast('Çöp kutusu boşaltıldı');
      } else if (a === 'copy-hash-url') {
        await navigator.clipboard.writeText(location.origin + '/clip/#img=').catch(() => {});
        toast('#img= kestirme ön eki kopyalandı');
      } else if (a === 'copy-shortcut-url') {
        await navigator.clipboard.writeText(location.origin + '/clip/?action=paste-edit').catch(() => {});
        toast('Kestirme adresi kopyalandı');
      }
    }));

    // Card tap vs long-press (iPhone touch friendly)
    $app.querySelectorAll('[data-card-id]').forEach(card => {
      let pressTimer = null, longFired = false;
      const id = card.dataset.cardId;
      const item = state.items.find(i => i.id === id);
      if (!item) return;

      card.addEventListener('pointerdown', () => {
        longFired = false;
        pressTimer = setTimeout(() => {
          longFired = true;
          openItemSheet(id);
        }, 420);
      });
      const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      card.addEventListener('pointermove', cancelPress);
      card.addEventListener('pointercancel', cancelPress);
      card.addEventListener('pointerup', () => {
        cancelPress();
        if (longFired) return;
        if (state.tab === 'library') openItemSheet(id);
        else void copyItem(item);
      });
    });
  }

  $photoPicker.addEventListener('change', async () => {
    const f = $photoPicker.files?.[0];
    $photoPicker.value = '';
    if (!f) return;
    const img = await blobToImage(f);
    await addImageBlob(f, img.naturalWidth, img.naturalHeight, f.name.replace(/\.[^.]+$/, ''));
    toast('Görsel ipe asıldı');
  });

  $editorPhotoPicker.addEventListener('change', async () => {
    const f = $editorPhotoPicker.files?.[0];
    $editorPhotoPicker.value = '';
    if (!f) return;
    await openEditorWithBlob(f);
  });

  window.addEventListener('resize', () => { if (state.editor) drawEditor(); });

  async function handleSmartSnip() {
    // 1. Try reading screenshot/image directly from iPhone clipboard first (no file-picker sheet!)
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const entries = await navigator.clipboard.read();
        for (const entry of entries) {
          const imgType = entry.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await entry.getType(imgType);
            await openEditorWithBlob(blob);
            return;
          }
        }
      }
    } catch {}
    // 2. If clipboard has no image yet, show clean Edna Dark choice sheet (never blindly open iOS file menu)
    $modal.innerHTML = `
      <div class="sheet-backdrop" id="snip-backdrop">
        <div class="sheet-panel">
          <div class="sheet-handle"></div>
          <h3 style="margin:0;font-size:16px">iPhone’da Ekran Alıntısı & Kırpma</h3>
          <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.45">
            iOS güvenlik kuralı gereği Safari tek başına ekran görüntüsü çekemez. En hızlı yol: <b>Arka Çift Dokunma (Back Tap)</b> kestirmesini bir kez kurmak — telefonun arkasına 2 kez dokununca doğrudan kırpma ekranı açılır!
          </p>
          <button class="pill-btn primary" id="snip-pick" style="width:100%;justify-content:center;padding:12px">${ICONS.photo} Galeriden / Son Ekran Görüntüsünden Seç</button>
          <button class="pill-btn success" id="snip-guide" style="width:100%;justify-content:center;padding:12px">${ICONS.settings} Arka Çift Dokunma Kurulumunu Göster (30 sn)</button>
        </div>
      </div>`;
    const close = () => { $modal.innerHTML = ''; };
    document.getElementById('snip-backdrop').addEventListener('click', e => { if (e.target.id === 'snip-backdrop') close(); });
    document.getElementById('snip-pick').addEventListener('click', () => { close(); $editorPhotoPicker.click(); });
    document.getElementById('snip-guide').addEventListener('click', () => { close(); state.tab = 'settings'; render(); });
  }

  async function tryOpenFromUrlHash() {
    const hash = location.hash || '';
    if (!hash.startsWith('#img=')) return false;
    const rawB64 = decodeURIComponent(hash.slice(5)).replace(/\s+/g, '');
    history.replaceState(null, '', '/clip/');
    if (rawB64.length < 32) return false;
    try {
      const bin = atob(rawB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const blob = new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' });
      await openEditorWithBlob(blob);
      return true;
    } catch {
      toast('Kestirmeden gelen görsel okunamadı');
      return false;
    }
  }

  // --- Boot ---
  async function init() {
    applyTheme(state.theme);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/clip/sw.js').catch(() => {});
    }
    state.items = await dbLoadAll();
    render();

    if (await tryOpenFromUrlHash()) return;
    window.addEventListener('hashchange', () => { void tryOpenFromUrlHash(); });

    // Handle iPhone Back Tap Shortcut deep-link (?action=paste-edit)
    const params = new URLSearchParams(location.search);
    const action = params.get('action');
    if (action === 'paste-edit') {
      history.replaceState(null, '', '/clip/');
      // Show 1-tap instant banner because iOS Safari requires a direct user tap for clipboard read
      $modal.innerHTML = `
        <div class="sheet-backdrop" id="sc-backdrop">
          <div class="sheet-panel" style="align-items:center;text-align:center">
            <div class="sheet-handle"></div>
            <h3 style="margin:0;font-size:17px">Ekran Alıntısı Hazır!</h3>
            <p style="margin:0;color:var(--muted);font-size:13.5px">Panodaki ekran görüntüsünü kırpma & Google Lens ekranında açmak için dokun:</p>
            <button class="pill-btn primary" id="sc-go" style="width:100%;justify-content:center;padding:13px;font-size:15px">${ICONS.crop} Alıntıyı Aç & Kırp</button>
          </div>
        </div>`;
      const close = () => { $modal.innerHTML = ''; };
      document.getElementById('sc-backdrop').addEventListener('click', e => { if (e.target.id === 'sc-backdrop') close(); });
      document.getElementById('sc-go').addEventListener('click', async () => {
        close();
        await pasteFromClipboard(true);
      });
    }
  }

  void init();
})();
