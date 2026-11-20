'use strict';
// Ekran alıntısı kaydedilince (Enter / Ctrl+C) ClipBoardLine öne gelmemeli:
// görüntü geçmişe eklenip panoya kopyalanır, pencere gizlenir ve odak önceki
// uygulamaya döner (cancelCapture ile aynı hide yolu).
// main.cjs için Electron ana süreç test altyapısı yok; bu test kayıt dalının
// kaynağını denetler ve rafı açan bir show() geri gelirse yakalar.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

function commitCaptureBranch(){
 const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 const start=src.indexOf("action==='commitCapture'");
 const end=src.indexOf("action==='cancelCapture'",start);
 assert.ok(start>0&&end>start,'commitCapture branch not found');
 return src.slice(start,end);
}

test('saving a capture still stores it and copies it to the clipboard',()=>{
 const branch=commitCaptureBranch();
 assert.match(branch,/store\.insert\('image'/);
 assert.match(branch,/writeImageClipboard\(finalBuffer\)/);
});

test('saving a capture hides the window instead of showing the shelves',()=>{
 const branch=commitCaptureBranch();
 assert.match(branch,/await hide\(\)/);
 assert.doesNotMatch(branch,/\bshow\(/);
});

test('commit writes clipboard with own fingerprint before insert',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 const branch=commitCaptureBranch();
 const write=branch.search(/await writeImageClipboard\(/),hidden=branch.indexOf('await hide()');
 const inserts=[branch.indexOf('store.insertAnnotatedImage('),branch.indexOf("store.insert('image'")];
 assert.ok(write>0,'rendered PNG goes to the clipboard through the shared image path');
 assert.ok(inserts.every(index=>index>write&&index>hidden),'clipboard and hide happen before the library insert');
 assert.match(branch,/catch\([^)]*\)\s*=>\s*\{?[^}]*notify\(|catch\s*\([^)]*\)\s*\{[^}]*notify\(/,'store failure is reported with notify');
 const fn=name=>{const at=src.indexOf('async function '+name+'(');assert.ok(at>0,name+' exists');const rest=src.slice(at);return rest.slice(0,rest.search(/\n}|\);}\n/)+3);};
 assert.match(fn('writeImageClipboard'),/writeMarkedClipboard\(/,'image helper uses the shared marked write');
 const marked=fn('writeMarkedClipboard');
 assert.match(marked,/copyMarker/);assert.match(marked,/ownFingerprint=/);assert.match(marked,/lastFingerprint=ownFingerprint/);
 assert.match(fn('writeClipboard'),/writeImageClipboard\(/,'writeClipboard reuses the same image path');
});

test('still hides, never shows',()=>{
 const branch=commitCaptureBranch();
 assert.match(branch,/await hide\(\)/);
 assert.doesNotMatch(branch,/\bshow\(/);
 assert.match(branch,/queueOCR\(item\.id\)/);assert.match(branch,/refreshImageSearch\(\)/);assert.match(branch,/shell\.beep\(\)/);
});

test('annotated commit: clipboard and hide never wait for the original PNG',()=>{
 const branch=commitCaptureBranch();
 const write=branch.search(/await writeImageClipboard\(/),hidden=branch.indexOf('await hide()');
 assert.doesNotMatch(branch,/originalDataUrl/,'the renderer no longer encodes and sends a second PNG');
 assert.match(branch,/payload\.originalRect/);
 const cut=branch.search(/\.crop\(/);assert.ok(cut>write&&cut>hidden,'the clean original is cut from the screenshot after clipboard + hide');
 assert.match(branch,/store\.insertAnnotatedImage\([^;]*\.crop\(rect\)\.toPNG\(\),finalBuffer,annotations\)/,'one new item gets original + rendered + annotations');
 assert.ok(branch.search(/pendingCapture\?\.buffer/)<branch.indexOf('pendingCapture=null'),'the screenshot buffer is kept before the capture is cleared');
});

test('copy:false commits without clipboard, beep or markCopied; default path still copies before hide',()=>{
 const branch=commitCaptureBranch();
 assert.match(branch,/const copyToClipboard=payload\.copy!==false;/,'copy:false is the only way to skip the clipboard');
 const guard=branch.indexOf('if(copyToClipboard){'),write=branch.search(/await writeImageClipboard\(finalBuffer\)/),beep=branch.indexOf('shell.beep()'),hidden=branch.indexOf('await hide()');
 assert.ok(guard>0&&guard<write&&write<beep&&beep<hidden,'clipboard write and beep are guarded and still precede hide');
 assert.match(branch,/if\(copyToClipboard\)\{\s*await writeImageClipboard\(finalBuffer\)\.catch\(\(\)=>\{\}\);\s*if\(store\.data\.settings\.sounds\)shell\.beep\(\);\s*\}/,'clipboard write and beep are both inside the guard');
 assert.match(branch,/if\(copyToClipboard\)store\.markCopied\(\[item\.id\]\)/);
 assert.match(branch,/result=\{id:item\?\.id\?\?null\}/);
});

test('output wiring: commands, watcher suppression, saved-path reveal and quit cleanup',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 for(const name of ['outputInfo','outputPlan','outputWrite','outputRun'])assert.ok(src.includes(`action==='${name}'`),name);
 assert.match(src,/if\(output\?\.ownsFile\(file\)\)return;/);
 assert.match(src,/await output\.savedFile\(item\.id\)/);
 assert.match(src,/void output\?\.cleanup\(\)/);
 assert.doesNotMatch(src,/copyFileSync|mkdirSync\(languageDirectory/,'OCR language files are prepared asynchronously');
});
