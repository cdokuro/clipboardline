'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('a failed shortcut restore names readable action titles, not action ids',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 assert.match(src,/const SHORTCUT_TITLES=\{toggle:'Show or hide the line',search:'Search shelves from other apps',library:'Open library',copyLatest:'Copy latest image',screenshot:'Screenshot',mini:'Open mini clipboard'\}/);
 assert.match(src,/'Could not restore: '\+unrestored\.map\(action=>SHORTCUT_TITLES\[action\]\|\|action\)\.join\(', '\)\+'\.'/);
});

test('import failures always use the localizable "Imported %d · failed %d. %@" template',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 assert.match(src,/if\(failures\.length\)message=`Imported \$\{imported\.length\} · failed \$\{failures\.length\}\. \$\{failures\[0\]\}`;/);
});
