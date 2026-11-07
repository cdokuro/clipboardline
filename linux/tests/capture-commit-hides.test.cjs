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
 assert.match(branch,/writeClipboard\(\[item\]\)/);
});

test('saving a capture hides the window instead of showing the shelves',()=>{
 const branch=commitCaptureBranch();
 assert.match(branch,/await hide\(\)/);
 assert.doesNotMatch(branch,/\bshow\(/);
});
