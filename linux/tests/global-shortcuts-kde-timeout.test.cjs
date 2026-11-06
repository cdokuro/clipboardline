'use strict';
// kglobalaccel takılırsa (ör. Plasma yeniden başlarken) her busctl çağrısı
// zaman aşımına kadar ana Electron sürecini bloklar. İlk zaman aşımından sonra
// KDE yolu kapanmalı (devre kesici) ve kalan kayıtlar beklemeden fallback'e gitmeli.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
// Güvenlik: bu dosya kendi sürecinde çalışır. PATH'i boş bir dizine çevir ki
// enjekte edilen exec/spawn yok sayılsa bile gerçek busctl/dbus-monitor
// bulunamasın ve canlı kglobalaccel kayıtlarına asla dokunulmasın.
process.env.PATH=fs.mkdtempSync(path.join(os.tmpdir(),'cbl-no-bin-'));
const noSpawn=()=>{throw new Error('spawn must not be called in this test');};
const {createLinuxShortcutRegistry}=require('../lib/global-shortcuts.cjs');

function timeoutError(){const e=new Error('spawnSync busctl ETIMEDOUT');e.code='ETIMEDOUT';return e;}
function fallbackFixture(){const calls=[];return{calls,register(key){calls.push(['register',key]);return true;},unregister(key){calls.push(['unregister',key]);}};}

// status ve shortcutNames başarılı, ilk getGlobalShortcutsByKey zaman aşımına uğrar
function hangingKglobalaccel(){
 const calls=[];
 const exec=(cmd,args,opts)=>{
  calls.push({args,timeout:opts&&opts.timeout});
  if(args.includes('status'))return '';
  if(args.includes('shortcutNames'))return 'as 0';
  throw timeoutError();
 };
 return{calls,exec};
}

test('every kglobalaccel call is bounded by a short timeout',{skip:process.platform!=='linux'},()=>{
 const k=hangingKglobalaccel(),fb=fallbackFixture();
 const registry=createLinuxShortcutRegistry(fb,{exec:k.exec,spawn:noSpawn});
 registry.register('Meta+V',()=>{});
 assert.ok(k.calls.length>0);
 for(const call of k.calls)assert.ok(call.timeout>0&&call.timeout<=400,'timeout '+call.timeout+' ms for '+call.args.join(' '));
});

test('after the first timeout the KDE path is skipped and remaining shortcuts go straight to fallback',{skip:process.platform!=='linux'},()=>{
 const k=hangingKglobalaccel(),fb=fallbackFixture();
 const registry=createLinuxShortcutRegistry(fb,{exec:k.exec,spawn:noSpawn});
 assert.equal(registry.register('Meta+V',()=>{}),true);
 const callsAfterFirst=k.calls.length;
 assert.ok(callsAfterFirst>0,'KDE path was attempted for the first shortcut');
 assert.equal(registry.register('Alt+Shift+L',()=>{}),true);
 assert.equal(registry.register('Alt+Shift+S',()=>{}),true);
 registry.unregister('Alt+Shift+S');
 assert.equal(k.calls.length,callsAfterFirst,'no busctl call after the breaker opened');
 assert.deepEqual(fb.calls,[['register','Meta+V'],['register','Alt+Shift+L'],['register','Alt+Shift+S'],['unregister','Alt+Shift+S']]);
});

test('a non-timeout busctl failure still falls back without disabling KDE for later shortcuts',{skip:process.platform!=='linux'},()=>{
 const calls=[],fb=fallbackFixture();
 const exec=(cmd,args)=>{calls.push(args);if(args.includes('status'))return '';if(args.includes('shortcutNames'))return 'as 0';const e=new Error('exit 1');e.status=1;throw e;};
 const registry=createLinuxShortcutRegistry(fb,{exec,spawn:noSpawn});
 registry.register('Meta+V',()=>{});
 const n=calls.length;
 registry.register('Alt+Shift+L',()=>{});
 assert.ok(calls.length>n,'KDE path is tried again for the next shortcut');
});
