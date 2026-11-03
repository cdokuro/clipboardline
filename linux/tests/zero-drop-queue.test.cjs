'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, plainURL } = require('../lib/model.cjs');
const { privateClipboard } = require('../lib/clipboard-policy.cjs');

test('FIFO queue processes rapid sequential copies without drops', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbl-fifo-'));
  try {
    const store = new Store(dataDir);
    const queue = [];
    let processing = false;
    let lastFp = '';
    const captured = [];

    async function handleEvent(ev) {
      if (ev.origin === 'clipboardline') return;
      if (privateClipboard(ev.types || [])) return;
      const fp = ev.fingerprint || crypto.createHash('sha256').update(ev.text).digest('hex');
      if (fp === lastFp) return;
      lastFp = fp;
      const item = store.insert('text', ev.text, { html: ev.html });
      captured.push(item);
    }

    async function processQueue() {
      if (processing) return;
      processing = true;
      try {
        while (queue.length > 0) {
          const item = queue.shift();
          await handleEvent(item);
        }
      } finally {
        processing = false;
      }
    }

    function enqueue(ev) {
      queue.push(ev);
      void processQueue();
    }

    // Enqueue 50 rapid distinct items synchronously
    for (let i = 0; i < 50; i++) {
      enqueue({
        seq: i + 1,
        text: `Rapid Item #${i}`,
        html: `<b>Rapid Item #${i}</b>`,
        types: ['text/plain', 'text/html'],
        origin: 'external',
        fingerprint: `fp-${i}`
      });
    }

    // Wait for queue drain
    while (queue.length > 0 || processing) {
      await new Promise(r => setTimeout(r, 5));
    }

    assert.equal(captured.length, 50, 'Exactly 50 items must be captured (zero drops)');
    for (let i = 0; i < 50; i++) {
      assert.equal(captured[i].text, `Rapid Item #${i}`);
      assert.equal(captured[i].html, `<b>Rapid Item #${i}</b>`);
    }
    // Verify store has 50 items
    assert.equal(store.data.items.length, 50);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('SHA-256 deduplication rejects consecutive identical fingerprints but preserves recurring cycles', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbl-dedup-'));
  try {
    const store = new Store(dataDir);
    let lastFp = '';
    const captured = [];

    function processItem(ev) {
      const fp = ev.fingerprint || crypto.createHash('sha256').update(ev.text).digest('hex');
      if (fp === lastFp) return;
      lastFp = fp;
      const item = store.insert('text', ev.text);
      captured.push(item);
    }

    // Copy A twice consecutively -> should record once
    processItem({ text: 'Alpha', fingerprint: 'fp-A' });
    processItem({ text: 'Alpha', fingerprint: 'fp-A' });
    assert.equal(captured.length, 1);

    // Copy B -> records B
    processItem({ text: 'Beta', fingerprint: 'fp-B' });
    assert.equal(captured.length, 2);

    // Copy A again -> non-consecutive recurring cycle, records A
    processItem({ text: 'Alpha', fingerprint: 'fp-A' });
    assert.equal(captured.length, 3);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Private admission filters reject concealed markers in stream events', () => {
  for (const marker of ['org.nspasteboard.ConcealedType', 'com.agilebits.onepassword']) {
    assert.equal(privateClipboard(['text/plain', marker]), true);
  }
  assert.equal(privateClipboard(['text/plain', 'text/html']), false);
});
