'use strict';
const {spawn,execFileSync}=require('node:child_process');
const ACTIONS=['toggle','search','library','copyLatest','screenshot','mini'];

const QT_SPECIAL_KEYS=Object.freeze({
 SPACE:0x20,ESCAPE:0x01000000,ESC:0x01000000,TAB:0x01000001,BACKSPACE:0x01000003,
 RETURN:0x01000004,ENTER:0x01000004,INSERT:0x01000006,DELETE:0x01000007,
 HOME:0x01000010,END:0x01000011,LEFT:0x01000012,ARROWLEFT:0x01000012,
 UP:0x01000013,ARROWUP:0x01000013,RIGHT:0x01000014,ARROWRIGHT:0x01000014,
 DOWN:0x01000015,ARROWDOWN:0x01000015,PAGEUP:0x01000016,PAGEDOWN:0x01000017
});

function qtKeyCode(accelerator){
 if(typeof accelerator!=='string'||!accelerator.trim())return 0;
 const parts=accelerator.split('+').map(p=>p.trim()).filter(Boolean);
 if(!parts.length)return 0;
 let mods=0,base=0;
 for(let i=0;i<parts.length;i++){
  const upper=parts[i].toUpperCase();
  if(i<parts.length-1){
   if(upper==='SHIFT')mods|=0x02000000;
   else if(['CTRL','CONTROL','COMMANDORCONTROL','CMDORCTRL'].includes(upper))mods|=0x04000000;
   else if(['ALT','OPTION'].includes(upper))mods|=0x08000000;
   else if(['META','SUPER','COMMAND','CMD'].includes(upper))mods|=0x10000000;
   else return 0;
  }else{
   if(upper.length===1&&upper>='A'&&upper<='Z')base=upper.charCodeAt(0);
   else if(upper.length===1&&upper>='0'&&upper<='9')base=upper.charCodeAt(0);
   else if(/^F([1-9]|1[0-9]|2[0-4])$/.test(upper))base=0x01000030+(Number(upper.slice(1))-1);
   else if(Object.hasOwn(QT_SPECIAL_KEYS,upper))base=QT_SPECIAL_KEYS[upper];
   else if(upper.length===1)base=upper.charCodeAt(0);
   else return 0;
  }
 }
 return base?(mods|base)>>>0:0;
}

function createLinuxShortcutRegistry(fallbackRegistry){
 if(process.platform!=='linux')return fallbackRegistry;
 let kdeAvailable=false;
 try{
  execFileSync('busctl',['--user','status','org.kde.kglobalaccel'],{stdio:'ignore',timeout:1500});
  kdeAvailable=true;
 }catch{}
 if(!kdeAvailable)return fallbackRegistry;

 const callbacks=new Map();
 let monitorProc=null;
 let buffer='';

 // Clean up any old registrations from previous sessions
 try{
  const out=execFileSync('busctl',['--user','call','org.kde.kglobalaccel','/component/clipboardline','org.kde.kglobalaccel.Component','shortcutNames'],{encoding:'utf8',timeout:1500,stdio:['ignore','pipe','ignore']});
  const matches=[...out.matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  for(const oldKey of matches){
   try{execFileSync('busctl',['--user','call','org.kde.kglobalaccel','/kglobalaccel','org.kde.KGlobalAccel','unregister','ss','clipboardline',oldKey],{stdio:'ignore',timeout:1500});}catch{}
  }
 }catch{}

 function ensureMonitor(){
  if(monitorProc)return;
  monitorProc=spawn('dbus-monitor',['--session',"type='signal',path='/component/clipboardline',interface='org.kde.kglobalaccel.Component',member='globalShortcutPressed'"],{stdio:['ignore','pipe','ignore']});
  monitorProc.unref?.();
  monitorProc.stdout.on('data',chunk=>{
   buffer+=chunk.toString('utf8');
   if(buffer.length>65536)buffer=buffer.slice(-16384);
   const pattern=/member=globalShortcutPressed[\s\S]*?string "clipboardline"\s+string "([^"]+)"/g;
   let match,lastIndex=0;
   while((match=pattern.exec(buffer))!==null){
    lastIndex=pattern.lastIndex;
    const key=match[1];
    const fn=callbacks.get(key);
    if(fn)setImmediate(()=>fn());
   }
   if(lastIndex>0)buffer=buffer.slice(lastIndex);
  });
  monitorProc.on('exit',()=>{monitorProc=null;});
 }

 return {
  register(key,callback){
   const code=qtKeyCode(key);
   if(!code)return fallbackRegistry.register(key,callback);
   try{
    const registerOne=(k,c)=>{
     const check=execFileSync('busctl',['--user','call','org.kde.kglobalaccel','/kglobalaccel','org.kde.KGlobalAccel','getGlobalShortcutsByKey','i',String(c)],{encoding:'utf8',timeout:2000}).trim();
     if(!check.startsWith('a(ssssssaiai) 0')){
      const strings=[...check.matchAll(/"([^"]*)"/g)].map(m=>m[1]);
      for(let i=0;i+2<strings.length;i+=6){
       if(strings[i+2]&&strings[i+2]!=='clipboardline')return false;
      }
     }
     execFileSync('busctl',['--user','call','org.kde.kglobalaccel','/kglobalaccel','org.kde.KGlobalAccel','doRegister','as','4','clipboardline',k,'ClipBoardLine','ClipBoardLine '+k],{stdio:'ignore',timeout:2000});
     const res=execFileSync('busctl',['--user','call','org.kde.kglobalaccel','/kglobalaccel','org.kde.KGlobalAccel','setShortcut','asaiu','4','clipboardline',k,'ClipBoardLine','ClipBoardLine '+k,'1',String(c),'6'],{encoding:'utf8',timeout:2000}).trim();
     if(!res.includes(String(c)) && !res.startsWith('ai 0') && !res.includes('ai'))return false;
     callbacks.set(k,callback);
     return true;
    };
    if(!registerOne(key,code))return false;
    ensureMonitor();
    return true;
   }catch{
    return fallbackRegistry.register(key,callback);
   }
  },
  unregister(key){
   callbacks.delete(key);
   try{
    execFileSync('busctl',['--user','call','org.kde.kglobalaccel','/kglobalaccel','org.kde.KGlobalAccel','unregister','ss','clipboardline',key],{stdio:'ignore',timeout:2000});
   }catch{
    try{fallbackRegistry.unregister(key);}catch{}
   }
  }
 };
}

// Only registrations owned by this instance are released. A recording lease
// suspends OS interception itself, so an existing combination reaches its field.
class GlobalShortcuts{
 constructor(registry,handlers,{failed=()=>{}}={}){this.registry=registry;this.handlers=handlers;this.failed=failed;this.registered=new Map();this.active=new Set();this.epochs=new Map();this.leases=new Set();this.disposed=false;}
 get suspended(){return this.leases.size>0;}
 register(action,key){
  const epoch=Symbol(action);const success=this.registry.register(key,()=>{
   if(this.disposed||this.suspended||this.registered.get(action)!==key||!this.active.has(action)||this.epochs.get(action)!==epoch)return;
   try{Promise.resolve(this.handlers[action]?.()).catch(this.failed);}catch(error){this.failed(error);}
  });if(success)this.epochs.set(action,epoch);return success;
 }
 suspend(){
  if(this.disposed)throw new Error('Shortcut registrations are closed.');
  const token=Symbol('recorder');this.leases.add(token);
  const resume=()=>{
   if(!this.leases.delete(token)||this.suspended||this.disposed)return;
   for(const[action,key]of this.registered){if(this.active.has(action))continue;let success=false;try{success=this.register(action,key);}catch{}
    if(success)this.active.add(action);else{this.registered.delete(action);this.failed(new Error('A shortcut could not be restored after recording. Choose another combination in Settings.'));}}
  };
  try{if(this.leases.size===1)for(const[action,key]of this.registered){if(this.active.has(action)){this.registry.unregister(key);this.active.delete(action);this.epochs.delete(action);}}}
  catch(error){resume();throw error;}
  return resume;
 }
 update(shortcuts){
  const rejected=[];
  for(const action of ACTIONS){
   const next=shortcuts[action]||'',previous=this.registered.get(action)||'';
   if(next===previous)continue;
   if(this.suspended||this.disposed){rejected.push({action,shortcut:next,previous});continue;}
   if(!next){if(previous&&this.active.has(action))this.registry.unregister(previous);this.active.delete(action);this.epochs.delete(action);this.registered.delete(action);continue;}
   let success=false;try{success=this.register(action,next);}catch{}
   if(success){if(previous&&this.active.has(action))this.registry.unregister(previous);this.registered.set(action,next);this.active.add(action);}
   else rejected.push({action,shortcut:next,previous});
  }
  return rejected;
 }
 dispose(){this.disposed=true;this.leases.clear();for(const[action,key]of this.registered){if(this.active.has(action)){try{this.registry.unregister(key);}catch{}}}this.active.clear();this.epochs.clear();this.registered.clear();}
}
module.exports={GlobalShortcuts,ACTIONS,createLinuxShortcutRegistry,qtKeyCode};
