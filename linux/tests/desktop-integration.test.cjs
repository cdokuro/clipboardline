'use strict';
// Sistem araçları adaptörü: yalnızca geçici dizinler, enjekte edilen execFile ve
// izole PATH kullanılır; gerçek $HOME, /usr, D-Bus veya oturuma dokunulmaz.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const di=require('../lib/desktop-integration.cjs');

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'cbl-di-'));}
function put(file,text,mode){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);if(mode)fs.chmodSync(file,mode);}
function desktop(file,fields){put(file,'[Desktop Entry]\nType=Application\n'+Object.entries(fields).map(([k,v])=>k+'='+v).join('\n')+'\n[Desktop Action x]\nName=Hidden action\n');}

test('imageApps orders default, added, cache and drops removed/hidden',async()=>{
 const root=tmp(),home=path.join(root,'home'),sys=path.join(root,'sys');
 const cfg=path.join(home,'.config'),data=path.join(home,'.local/share');
 put(path.join(cfg,'mimeapps.list'),'[Default Applications]\nimage/png=b.desktop\n[Added Associations]\nimage/png=c.desktop;\n[Removed Associations]\nimage/png=d.desktop\n');
 put(path.join(sys,'applications/mimeinfo.cache'),'[MIME Cache]\nimage/png=a.desktop;d.desktop;e.desktop;f.desktop;\nimage/jpeg=z.desktop;\n');
 for(const id of ['a','b','c','d'])desktop(path.join(sys,'applications',id+'.desktop'),{Name:id.toUpperCase(),'Name[tr]':id+'-tr'});
 desktop(path.join(data,'applications/e.desktop'),{Name:'E',NoDisplay:'true'});
 // f.desktop yok: atlanır
 const env={XDG_CONFIG_HOME:cfg,XDG_DATA_HOME:data,XDG_DATA_DIRS:sys,XDG_CONFIG_DIRS:path.join(root,'etc')};
 const en=await di.imageApps({env,home});
 assert.deepEqual(en.map(a=>a.id),['b.desktop','c.desktop','a.desktop']);
 assert.deepEqual(en.map(a=>a.name),['B','C','A']);
 assert.equal(en[0].file,path.join(sys,'applications/b.desktop'));
 const tr=await di.imageApps({env,home,language:'tr'});
 assert.deepEqual(tr.map(a=>a.name),['b-tr','c-tr','a-tr']);
});

test('imageApps drops Hidden entries and dedups ids; kde-mimeapps.list is read',async()=>{
 const root=tmp(),home=path.join(root,'home');
 const cfg=path.join(home,'.config'),data=path.join(home,'.local/share');
 put(path.join(cfg,'kde-mimeapps.list'),'[Default Applications]\nimage/png=a.desktop;a.desktop;h.desktop;\n');
 desktop(path.join(data,'applications/a.desktop'),{Name:'A'});
 desktop(path.join(data,'applications/h.desktop'),{Name:'H',Hidden:'true'});
 const apps=await di.imageApps({env:{XDG_CONFIG_HOME:cfg,XDG_DATA_HOME:data,XDG_DATA_DIRS:path.join(root,'none')},home});
 assert.deepEqual(apps.map(a=>a.id),['a.desktop']);
});

test('imageApps falls back to XDG default dirs under the given home',async()=>{
 const root=tmp(),home=path.join(root,'home');
 desktop(path.join(home,'.local/share/applications/a.desktop'),{Name:'A'});
 put(path.join(home,'.local/share/applications/mimeinfo.cache'),'[MIME Cache]\nimage/png=a.desktop;\n');
 const apps=await di.imageApps({env:{XDG_DATA_DIRS:path.join(root,'none'),XDG_CONFIG_DIRS:path.join(root,'none')},home});
 assert.deepEqual(apps.map(a=>a.id),['a.desktop']);
});

test('launchCommand passes the file as one argument',()=>{
 assert.deepEqual(di.launchCommand('/apps/b.desktop','/x/a b.png'),{command:'gio',args:['launch','/apps/b.desktop','/x/a b.png']});
});

test('parseZbarXml reads text and binary symbols',()=>{
 const xml="<barcodes xmlns='http://zbar.sourceforge.net/2008/barcode'><source href='f.png'><index num='0'>"+
  "<symbol type='QR-Code' quality='1' orientation='UP'><data><![CDATA[https://example.com]]></data></symbol>"+
  "<symbol type='QR-Code'><data format='base64' length='1'><![CDATA[/w==]]></data></symbol>"+
  "</index></source></barcodes>";
 assert.deepEqual(di.parseZbarXml(xml),[{type:'QR-Code',text:'https://example.com',binary:false},{type:'QR-Code',text:null,binary:true}]);
 const b64=Buffer.from('Merhaba ş').toString('base64');
 assert.deepEqual(di.parseZbarXml("<symbol type='CODE-128'><data format='base64' length='10'><![CDATA["+b64+"]]></data></symbol>"),[{type:'CODE-128',text:'Merhaba ş',binary:false}]);
 assert.deepEqual(di.parseZbarXml(''),[]);
});

test('parseZbarXml treats control characters as binary but keeps tab and newlines',()=>{
 const enc=s=>"<symbol type='QR-Code'><data format='base64'><![CDATA["+Buffer.from(s).toString('base64')+"]]></data></symbol>";
 assert.equal(di.parseZbarXml(enc('a\u0000b'))[0].binary,true);
 assert.deepEqual(di.parseZbarXml(enc('a\tb\r\nc')),[{type:'QR-Code',text:'a\tb\r\nc',binary:false}]);
 assert.deepEqual(di.parseZbarXml("<symbol type='QR-Code'><data>a&amp;b</data></symbol>"),[{type:'QR-Code',text:'a&b',binary:false}]);
});

test('scanCodes maps exit codes',async()=>{
 const missing=async()=>{const e=new Error('spawn zbarimg ENOENT');e.code='ENOENT';throw e;};
 assert.deepEqual(await di.scanCodes('/x/a.png',{execFile:missing}),{available:false,codes:[]});
 const none=async()=>{const e=new Error('exit 4');e.code=4;throw e;};
 assert.deepEqual(await di.scanCodes('/x/a.png',{execFile:none}),{available:true,codes:[]});
 const calls=[];
 const ok=async(cmd,args,opts)=>{calls.push({cmd,args,opts});return{stdout:"<symbol type='QR-Code'><data><![CDATA[hi]]></data></symbol>",stderr:''};};
 const r=await di.scanCodes('/x/a b.png',{execFile:ok});
 assert.deepEqual(r,{available:true,codes:[{type:'QR-Code',text:'hi',binary:false}]});
 assert.equal(calls[0].cmd,'zbarimg');
 assert.deepEqual(calls[0].args,['--xml','-q','--nodbus','-Sqrcode.binary','/x/a b.png']);
 assert.equal(calls[0].opts.timeout,10000);
 assert.equal(calls[0].opts.maxBuffer,4*1024*1024);
 const boom=async()=>{const e=new Error('killed');e.code=1;throw e;};
 await assert.rejects(di.scanCodes('/x/a.png',{execFile:boom}),/killed/);
});

test('ocrLanguages merges bundled and system data',async()=>{
 const root=tmp(),bundled=path.join(root,'ocr-data'),sys=path.join(root,'tessdata');
 for(const c of ['eng','tur'])put(path.join(bundled,c,'4.0.0_best_int',c+'.traineddata.gz'),'x');
 fs.mkdirSync(path.join(bundled,'junk'),{recursive:true});
 for(const c of ['eng','deu','osd','equ','xyz'])put(path.join(sys,c+'.traineddata'),'x');
 put(path.join(sys,'readme.txt'),'x');
 const list=await di.ocrLanguages({bundledDir:bundled,systemDirs:[sys,path.join(root,'missing')]});
 assert.deepEqual(list.map(l=>l.code),['deu','eng','tur','xyz']);
 const by=Object.fromEntries(list.map(l=>[l.code,l]));
 assert.equal(by.eng.source,'bundled');
 assert.equal(by.eng.file,path.join(bundled,'eng/4.0.0_best_int/eng.traineddata.gz'));
 assert.equal(by.deu.source,'system');
 assert.equal(by.deu.file,path.join(sys,'deu.traineddata'));
 assert.deepEqual(by.tur.name,{en:'Turkish',tr:'Türkçe'});
 assert.deepEqual(by.deu.name,{en:'German',tr:'Almanca'});
 assert.deepEqual(by.xyz.name,{en:'xyz',tr:'xyz'});
});

function fakeBin(names){const dir=tmp();for(const n of names)put(path.join(dir,n),'#!/bin/sh\nexit 0\n',0o755);return dir;}

test('toolAvailable searches the given PATH for executables only',async()=>{
 const bin=fakeBin(['zbarimg']);put(path.join(bin,'plain'),'x',0o644);
 assert.equal(await di.toolAvailable('zbarimg',{PATH:bin}),true);
 assert.equal(await di.toolAvailable('plain',{PATH:bin}),false);
 assert.equal(await di.toolAvailable('nothing',{PATH:bin}),false);
 assert.equal(await di.toolAvailable('zbarimg',{PATH:''}),false);
});

test('shareAvailable needs qml6 and the purpose module',async()=>{
 const bin=fakeBin(['qml6']),empty=fakeBin([]);
 const qml=tmp();put(path.join(qml,'org/kde/purpose/qmldir'),'module org.kde.purpose\n');
 const none=path.join(tmp(),'nope');
 assert.equal(await di.shareAvailable({env:{PATH:bin,QML_IMPORT_PATH:qml},qmlDirs:[none]}),true);
 assert.equal(await di.shareAvailable({env:{PATH:bin},qmlDirs:[qml]}),true);
 assert.equal(await di.shareAvailable({env:{PATH:bin,QML_IMPORT_PATH:none},qmlDirs:[none]}),false);
 assert.equal(await di.shareAvailable({env:{PATH:empty,QML_IMPORT_PATH:qml},qmlDirs:[qml]}),false);
});
