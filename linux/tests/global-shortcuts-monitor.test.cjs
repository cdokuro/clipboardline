'use strict';
// Linux kaydı kısayol sinyalleri için bir dbus-monitor başlatır. Uygulama
// kapanırken (before-quit -> GlobalShortcuts.dispose) bu süreç sonlandırılmazsa
// yetim kalır ve her yeniden başlatmada bir tane birikir.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
// Güvenlik: gerçek busctl/dbus-monitor asla bulunamasın (canlı kglobalaccel'e dokunma).
process.env.PATH=fs.mkdtempSync(path.join(os.tmpdir(),'cbl-no-bin-'));
const {GlobalShortcuts,createLinuxShortcutRegistry}=require('../lib/global-shortcuts.cjs');

// kglobalaccel her çağrıda başarılı yanıt verir
function healthyKglobalaccel(){
 return (cmd,args)=>{
  if(args.includes('status'))return '';
  if(args.includes('shortcutNames'))return 'as 0';
  if(args.includes('getGlobalShortcutsByKey'))return 'a(ssssssaiai) 0';
  if(args.includes('doRegister'))return '';
  if(args.includes('setShortcut'))return 'ai 1 '+args[args.length-2];
  return '';
 };
}
function fakeSpawn(){
 const procs=[];
 const spawn=()=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.killed=false;p.kill=()=>{p.killed=true;p.emit('exit');return true;};p.unref=()=>{};procs.push(p);return p;};
 return{procs,spawn};
}
const handlers={toggle(){},search(){},library(){},copyLatest(){},screenshot(){},mini(){}};

test('disposing the shortcuts terminates the dbus-monitor started for KDE shortcuts',{skip:process.platform!=='linux'},()=>{
 const s=fakeSpawn();
 const registry=createLinuxShortcutRegistry({register(){return true;},unregister(){}},{exec:healthyKglobalaccel(),spawn:s.spawn});
 const shortcuts=new GlobalShortcuts(registry,handlers);
 assert.deepEqual(shortcuts.update({mini:'Meta+V',library:'Alt+Shift+L'}),[]);
 assert.equal(s.procs.length,1,'one monitor for all shortcuts');
 shortcuts.dispose();
 assert.equal(s.procs[0].killed,true,'monitor must be killed on dispose');
});

test('dispose without any KDE registration does not throw',{skip:process.platform!=='linux'},()=>{
 const s=fakeSpawn();
 const registry=createLinuxShortcutRegistry({register(){return true;},unregister(){}},{exec:healthyKglobalaccel(),spawn:s.spawn});
 const shortcuts=new GlobalShortcuts(registry,handlers);
 shortcuts.dispose();
 assert.equal(s.procs.length,0);
});
