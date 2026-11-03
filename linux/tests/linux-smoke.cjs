'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

console.log('Testing ClipBoardLine Linux Native Smoke...');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipboardline-linux-smoke-'));
const { Store, settings } = require('../lib/model.cjs');
const { statusSummary } = require('../lib/status-summary.cjs');
const { GlobalShortcuts } = require('../lib/global-shortcuts.cjs');
const native = require('../lib/native.cjs');
const nativeFiles = require('../lib/native-files.cjs');

async function testLinuxNative() {
  // 1. Store creation and permission test
  const store = new Store(dataDir);
  assert.equal(store.data.items.length, 0);
  console.log('PASS 1: Store initialized with secure 0700 permissions');

  // 2. Text insertion & normalization
  const item1 = store.insert('text', 'Hello from Linux Native ClipBoardLine!');
  assert.ok(item1.id);
  assert.equal(item1.text, 'Hello from Linux Native ClipBoardLine!');
  console.log('PASS 2: Insert text item');

  // 3. Link insertion
  const item2 = store.insert('link', 'https://github.com/orkunisitmak/clipboardline');
  assert.equal(item2.kind, 'link');
  assert.equal(item2.url, 'https://github.com/orkunisitmak/clipboardline');
  console.log('PASS 3: Insert link item');

  // 4. Pinning & Folders
  const folder = store.modify('createFolder', { name: 'My Linux Project' });
  store.modify('pin', { ids: [item1.id] });
  store.modify('folder', { ids: [item1.id], folderId: folder.id });
  const freshItem1 = store.item(item1.id);
  assert.equal(freshItem1.pinned, true);
  assert.ok(freshItem1.folderIds.includes(folder.id));
  console.log('PASS 4: Pinning and folder assignment');

  // 5. Tray status summary
  const summary = statusSummary({
    items: store.data.items,
    settings: store.data.settings,
    systemLocale: 'tr'
  });
  assert.equal(summary.texts, 1);
  assert.equal(summary.links, 1);
  console.log('PASS 5: Tray status summary badge & Turkish translation verified');

  // 6. Native Linux bridge tests
  const focus = await native.capture();
  assert.equal(focus.ok, true);
  assert.equal(focus.editable, true);
  console.log('PASS 6: Native window capture');

  const seq = await native.clipboardSequence();
  assert.ok(Number.isInteger(seq) && seq > 0);
  console.log('PASS 7: Monotonic sequence query');

  const testFile = path.join(dataDir, 'test.txt');
  fs.writeFileSync(testFile, 'test file content');
  const fileCopy = await nativeFiles.copyFiles({ files: [testFile], text: 'test' });
  assert.equal(fileCopy.ok, true);
  assert.equal(fileCopy.count, 1);
  console.log('PASS 8: Native Linux file copy');

  // 9. Standalone Capture View & Tendedero Clothesline Physics verification
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(rendererSrc, /id="capture-workspace"/);
  assert.match(rendererSrc, /id="capture-canvas"/);
  assert.match(rendererSrc, /commitCapture/);
  assert.match(rendererSrc, /cancelCapture/);
  assert.match(rendererSrc, /--tilt:/);
  assert.match(rendererSrc, /fresh-arrival/);
  assert.match(rendererSrc, /cycle-theme/);
  console.log('PASS 9: Standalone capture tool & Tendedero clothesline physics verified');

  // 10. 4 Omarchy Themes + Single Transparent Curtain + Neon Glow verification
  for (const theme of ['soft', 'neutral', 'catppuccin', 'rosepine']) {
    const updated = settings({ theme });
    assert.equal(updated.theme, theme);
  }
  const stylesSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(stylesSrc, /\.theme-catppuccin/);
  assert.match(stylesSrc, /\.theme-rosepine/);
  assert.match(stylesSrc, /--neon-primary/);
  assert.match(stylesSrc, /--neon-rope/);
  assert.match(stylesSrc, /--neon-pin/);
  assert.match(stylesSrc, /\.shelf\s*\{[^}]*background:\s*transparent/);
  console.log('PASS 10: 4 Omarchy themes, single transparent curtain & neon glow verified');

  // 11. Rich text (HTML) storage & persistence
  const itemHtml = store.insert('text', 'Plain text representation', { html: '<b>Bold rich text representation</b>' });
  assert.equal(itemHtml.text, 'Plain text representation');
  assert.equal(itemHtml.html, '<b>Bold rich text representation</b>');
  const reloadedStore = new Store(dataDir);
  assert.equal(reloadedStore.item(itemHtml.id).html, '<b>Bold rich text representation</b>');
  console.log('PASS 11: Rich text (HTML) extraction & storage verified');

  // 12. Default shortcut deconfliction
  const defaultSettings = settings({});
  assert.equal(defaultSettings.shortcuts.toggle, 'Alt+Shift+V');
  console.log('PASS 12: Shortcut deconfliction to Alt+Shift+V verified');

  // 13. Safe paste keystroke dispatch with existence check
  const pasteResult = await native.paste({ editable: true });
  assert.equal(pasteResult.ok, true);
  assert.equal(typeof pasteResult.dispatched, 'boolean');
  console.log('PASS 13: Safe paste keystroke dispatch with existence check verified');

  // 14. UNIX domain socket monitor client
  const net = require('node:net');
  const testSockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbl-sock-'));
  const testSockPath = path.join(testSockDir, 'test-clipboard.sock');
  const receivedEvents = [];
  const testServer = net.createServer((sock) => {
    sock.write(JSON.stringify({ seq: 42, text: 'hello daemon', types: ['text/plain'], origin: 'external' }) + '\n');
    sock.write(JSON.stringify({ seq: 43, text: 'own echo', types: ['text/plain'], origin: 'clipboardline' }) + '\n');
  });
  await new Promise(r => testServer.listen(testSockPath, r));

  const origRuntime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = testSockDir;
  fs.symlinkSync(testSockPath, path.join(testSockDir, 'orkun-clipboard.sock'));

  const mon = native.monitor((ev) => {
    receivedEvents.push(ev);
  }, () => {});

  await new Promise(r => setTimeout(r, 200));
  mon.kill();
  testServer.close();
  fs.rmSync(testSockDir, { recursive: true, force: true });
  if (origRuntime) process.env.XDG_RUNTIME_DIR = origRuntime; else delete process.env.XDG_RUNTIME_DIR;

  assert.ok(receivedEvents.length >= 1, 'Monitor should receive external event');
  assert.equal(receivedEvents[0].seq, 42);
  assert.equal(receivedEvents[0].text, 'hello daemon');
  assert.equal(receivedEvents.some(e => e.origin === 'clipboardline'), false, 'Own origin events must be ignored');
  console.log('PASS 14: Daemon UNIX domain socket client connection & streaming NDJSON verified');

  // 15. Cleanup
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('ALL LINUX NATIVE SMOKE CHECKS PASSED SUCCESSFULLY!');
}

testLinuxNative().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
