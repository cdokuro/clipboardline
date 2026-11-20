'use strict';
// Sistem araçları adaptörü: "Birlikte aç" uygulamaları (MIME veritabanı), gio launch,
// zbarimg ile QR/barkod, tessdata OCR dilleri ve KDE Purpose paylaşım kullanılabilirliği.
// Tüm dosya erişimi async fs.promises; alt süreçler yalnızca enjekte edilen async execFile ile.
const nodeFs=require('node:fs').promises;
const X_OK=require('node:fs').constants.X_OK;
const path=require('node:path');
const childProcess=require('node:child_process');
const {promisify}=require('node:util');

const NAMES={
 eng:['English','İngilizce'],tur:['Turkish','Türkçe'],deu:['German','Almanca'],fra:['French','Fransızca'],
 spa:['Spanish','İspanyolca'],aze:['Azerbaijani','Azerbaycanca'],ita:['Italian','İtalyanca'],por:['Portuguese','Portekizce'],
 rus:['Russian','Rusça'],ara:['Arabic','Arapça'],nld:['Dutch','Felemenkçe'],pol:['Polish','Lehçe'],
 ukr:['Ukrainian','Ukraynaca'],jpn:['Japanese','Japonca'],kor:['Korean','Korece'],bul:['Bulgarian','Bulgarca'],
 ell:['Greek','Yunanca'],fas:['Persian','Farsça'],kaz:['Kazakh','Kazakça'],uzb:['Uzbek','Özbekçe']
};

function splitList(v){return String(v||'').split(';').map(s=>s.trim()).filter(Boolean);}
function dirList(v,fallback){const parts=String(v||'').split(':').filter(Boolean);return parts.length?parts:fallback;}

// INI benzeri dosya: {grup:{anahtar:değer}}; yorum ve boş satırlar atlanır.
function parseIni(text){
 const groups={};let cur=null;
 for(const raw of String(text).split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line[0]==='#'||line[0]===';')continue;
  const g=/^\[(.+)\]$/.exec(line);
  if(g){cur=groups[g[1]]=groups[g[1]]||{};continue;}
  if(!cur)continue;
  const i=line.indexOf('=');
  if(i<1)continue;
  const k=line.slice(0,i).trim();
  if(!(k in cur))cur[k]=line.slice(i+1).trim();
 }
 return groups;
}

async function readIni(fs,file){
 try{return parseIni(await fs.readFile(file,'utf8'));}catch(e){return null;}
}

async function imageApps({env=process.env,home,language='en',fs=nodeFs,mime='image/png'}={}){
 const cfgHome=env.XDG_CONFIG_HOME||path.join(home,'.config');
 const dataHome=env.XDG_DATA_HOME||path.join(home,'.local/share');
 const cfgDirs=[cfgHome,...dirList(env.XDG_CONFIG_DIRS,['/etc/xdg'])];
 const dataDirs=[dataHome,...dirList(env.XDG_DATA_DIRS,['/usr/local/share','/usr/share'])];
 const defaults=[],added=[],removed=new Set(),cached=[];
 for(const dir of cfgDirs){
  for(const name of ['mimeapps.list','kde-mimeapps.list']){
   const ini=await readIni(fs,path.join(dir,name));
   if(!ini)continue;
   if(ini['Default Applications'])defaults.push(...splitList(ini['Default Applications'][mime]));
   if(ini['Added Associations'])added.push(...splitList(ini['Added Associations'][mime]));
   if(ini['Removed Associations'])for(const id of splitList(ini['Removed Associations'][mime]))removed.add(id);
  }
 }
 for(const dir of dataDirs){
  const ini=await readIni(fs,path.join(dir,'applications','mimeinfo.cache'));
  if(ini&&ini['MIME Cache'])cached.push(...splitList(ini['MIME Cache'][mime]));
 }
 const apps=[],seen=new Set();
 for(const id of [...defaults,...added,...cached]){
  if(seen.has(id))continue;
  seen.add(id);
  if(removed.has(id))continue;
  const rels=[id];
  if(id.includes('-'))rels.push(id.replace('-','/'));
  let found=null;
  for(const dir of dataDirs){
   for(const rel of rels){
    const file=path.join(dir,'applications',rel);
    const ini=await readIni(fs,file);
    if(ini&&ini['Desktop Entry']){found={file,entry:ini['Desktop Entry']};break;}
   }
   if(found)break;
  }
  if(!found)continue;
  const e=found.entry;
  if(/^true$/i.test(e.NoDisplay||'')||/^true$/i.test(e.Hidden||''))continue;
  const name=(language==='tr'&&e['Name[tr]'])||e.Name||id.replace(/\.desktop$/,'');
  apps.push({id,name,file:found.file});
 }
 return apps;
}

function launchCommand(desktopFile,file){return{command:'gio',args:['launch',desktopFile,file]};}

function decodeEntities(s){
 return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,(m,e)=>{
  if(e==='lt')return '<';if(e==='gt')return '>';if(e==='amp')return '&';if(e==='quot')return '"';if(e==='apos')return "'";
  const n=e[1]==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);
  try{return String.fromCodePoint(n);}catch(_){return m;}
 });
}

function dataContent(raw){
 // CDATA bölümleri birleştirilir; CDATA dışındaki metin varlık çözülerek eklenir.
 let out='',last=0;const re=/<!\[CDATA\[([\s\S]*?)\]\]>/g;let m;
 while((m=re.exec(raw))){out+=decodeEntities(raw.slice(last,m.index))+m[1];last=m.index+m[0].length;}
 return out+decodeEntities(raw.slice(last));
}

function parseZbarXml(xml){
 const out=[];
 const symRe=/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g;let m;
 while((m=symRe.exec(String(xml||'')))){
  const type=(/\btype=['"]([^'"]*)['"]/.exec(m[1])||[])[1]||'';
  const d=/<data\b([^>]*)>([\s\S]*?)<\/data>/.exec(m[2]);
  if(!d)continue;
  const content=dataContent(d[2]);
  let bytes;
  if(/\bformat=['"]base64['"]/.test(d[1])){try{bytes=Buffer.from(content.replace(/\s+/g,''),'base64');}catch(_){bytes=null;}}
  else bytes=Buffer.from(content,'utf8');
  let text=null;
  if(bytes){
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){text=null;}
   if(text!==null&&/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))text=null;
  }
  out.push({type,text,binary:text===null});
 }
 return out;
}

async function scanCodes(file,{execFile=promisify(childProcess.execFile),env=process.env}={}){
 try{
  const r=await execFile('zbarimg',['--xml','-q','--nodbus','-Sqrcode.binary',file],{timeout:10000,maxBuffer:4*1024*1024,env,encoding:'utf8'});
  return{available:true,codes:parseZbarXml(r&&r.stdout)};
 }catch(e){
  if(e&&e.code==='ENOENT')return{available:false,codes:[]};
  if(e&&e.code===4)return{available:true,codes:[]};
  throw e;
 }
}

async function toolAvailable(name,env=process.env,fs=nodeFs){
 if(!name||name.includes('/'))return false;
 for(const dir of String(env.PATH||'').split(':').filter(Boolean)){
  try{await fs.access(path.join(dir,name),X_OK);return true;}catch(_){}
 }
 return false;
}

async function shareAvailable({env=process.env,fs=nodeFs,qmlDirs=['/usr/lib/qt6/qml']}={}){
 if(!await toolAvailable('qml6',env,fs))return false;
 const dirs=[...String(env.QML_IMPORT_PATH||'').split(':').filter(Boolean),...qmlDirs];
 for(const dir of dirs){
  try{await fs.access(path.join(dir,'org/kde/purpose/qmldir'));return true;}catch(_){}
 }
 return false;
}

async function ocrLanguages({bundledDir,systemDirs=['/usr/share/tessdata'],fs=nodeFs}={}){
 const found=new Map();
 const skip=c=>c==='osd'||c==='equ';
 if(bundledDir){
  let names=[];
  try{names=await fs.readdir(bundledDir);}catch(_){}
  for(const code of names){
   if(skip(code))continue;
   const file=path.join(bundledDir,code,'4.0.0_best_int',code+'.traineddata.gz');
   try{await fs.access(file);found.set(code,{code,source:'bundled',file});}catch(_){}
  }
 }
 for(const dir of systemDirs){
  let names=[];
  try{names=await fs.readdir(dir);}catch(_){}
  for(const n of names){
   const mm=/^(.+)\.traineddata$/.exec(n);
   if(!mm||skip(mm[1])||found.has(mm[1]))continue;
   found.set(mm[1],{code:mm[1],source:'system',file:path.join(dir,n)});
  }
 }
 return[...found.values()].sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:0).map(l=>{
  const n=NAMES[l.code];
  return{code:l.code,name:{en:n?n[0]:l.code,tr:n?n[1]:l.code},source:l.source,file:l.file};
 });
}

module.exports={imageApps,launchCommand,parseZbarXml,scanCodes,toolAvailable,shareAvailable,ocrLanguages};
