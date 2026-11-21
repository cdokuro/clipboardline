'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {updatesSupported,publicUpdateState,LINUX_UPDATE_MESSAGE}=require('../lib/update-channel.cjs');

test('only Windows uses the signed Windows installer update channel',()=>{
 assert.equal(updatesSupported('win32'),true);
 for(const platform of ['linux','darwin','freebsd'])assert.equal(updatesSupported(platform),false);
});

test('on Linux a cached Windows manifest never surfaces as an installable update',()=>{
 const windowsState={status:'ready',busy:false,canInstall:true,availableVersion:'9.9.9',availableBuild:999,version:'9.9.9',message:'ClipBoardLine 9.9.9 is available.',checkedAt:1,error:null};
 assert.deepEqual(publicUpdateState(windowsState,'win32'),windowsState);
 const linux=publicUpdateState(windowsState,'linux');
 assert.equal(linux.supported,false);assert.equal(linux.canInstall,false);assert.equal(linux.availableVersion,null);
 assert.equal(linux.status,'unsupported');assert.equal(linux.message,LINUX_UPDATE_MESSAGE);
 assert.match(LINUX_UPDATE_MESSAGE,/Linux/);
});

test('main.cjs gates the scheduler, announcements, tray entries and checks on the update channel',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 assert.match(src,/const UPDATES_SUPPORTED=updatesSupported\(process\.platform\)/);
 assert.match(src,/new AutomaticUpdateScheduler\(updates,\{enabled:\(\)=>UPDATES_SUPPORTED&&/);
 assert.match(src,/function updateAvailable\(manifest\)\{\s*if\(!UPDATES_SUPPORTED\)return;/);
 assert.match(src,/\.\.\.\(UPDATES_SUPPORTED\?\[/,'tray update entries only where updates are supported');
 assert.match(src,/update:publicUpdateState\(updates\.state,process\.platform\)/);
 assert.match(src,/action==='checkUpdates'\|\|action==='refreshUpdates'\)\{if\(!UPDATES_SUPPORTED\)/);
 assert.match(src,/if\(UPDATES_SUPPORTED\)\{updateTimer=setInterval/);
});
