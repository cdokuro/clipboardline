'use strict';
// ClipBoardLine tepside sürekli bekler; boşta bellek ayak izini küçük tutan
// Chromium anahtarları main.cjs'te uygulama hazır olmadan önce eklenmelidir.
// main.cjs için Electron ana süreç test altyapısı yok; kaynağı denetler.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');

test('Linux runs the (already unsandboxed) network service in the browser process before app is ready',()=>{
 const at=src.search(/appendSwitch\('enable-features','NetworkServiceInProcess2'\)/);
 assert.ok(at>0,'network service in-process switch missing');
 assert.ok(at<src.indexOf('app.whenReady()'),'switch must precede app.whenReady');
 assert.match(src.slice(Math.max(0,at-200),at),/process\.platform==='linux'/);
});

test('GPU compositing stays enabled so Meta+V keeps its first-frame latency',()=>{
 assert.doesNotMatch(src,/disable-gpu-compositing|disableHardwareAcceleration\(\)/);
});
