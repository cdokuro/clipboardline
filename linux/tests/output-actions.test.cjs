'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Store}=require('../lib/model.cjs');
const O=require('../lib/output-actions.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(16)]);
const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8 '),Buffer.alloc(8)]);
const url=(mime,buffer)=>`data:${mime};base64,${buffer.toString('base64')}`;

async function fixture(fn,{saveFolder,language='en',extra}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{
    const store=new Store(path.join(root,'store'));
    const folder=saveFolder||path.join(root,'shots');
    store.data.settings.output.saveFolder=folder;
    const clock={time:new Date(2026,10,20,9,5,7).getTime()};
    const calls={notify:[],text:[],reveal:[],dialog:[]};
    const state={dialogResult:{canceled:true}};
    const runtimeDir=path.join(root,'run');fs.mkdirSync(runtimeDir);
    const actions=new O.OutputActions({store,settings:()=>store.data.settings,now:()=>new Date(clock.time),home:path.join(root,'home'),configHome:path.join(root,'config'),runtimeDir,language:()=>language,
      dialog:{showSaveDialog:async options=>{calls.dialog.push(options);return state.dialogResult;}},
      writeText:async text=>{calls.text.push(text);},reveal:file=>{calls.reveal.push(file);},notify:(text,more)=>{calls.notify.push([text,more]);},...(extra?extra({root,store,calls,runtimeDir}):{})});
    const item=store.insert('image',png);
    await fn({root,store,actions,item,clock,calls,state,folder,runtimeDir});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('template expands every placeholder',()=>{
  const d=new Date(2026,10,20,9,5,7);
  assert.equal(O.fileBaseName('<yyyy>-<yy>-<MM>-<dd>_<hh><mm><ss>_<title>_<#>',d,{title:'T',number:3}),'2026-26-11-20_090507_T_3');
  assert.equal(O.fileBaseName('<hh>',new Date(2026,10,20,21,5,7)),'21');
});
test('template sanitises forbidden characters but keeps unicode',()=>{
  const d=new Date(2026,10,20,9,5,7);
  assert.equal(O.fileBaseName('<title>',d,{title:'Rapor/Ağustos: şema?'}),'Rapor-Ağustos- şema');
  assert.equal(O.fileBaseName('<title>',d,{title:''}),'Screenshot');
  assert.equal(O.fileBaseName('x'.repeat(300),d).length,200);
});
test('unique path numbers collisions',async()=>{
  const d=new Date(2026,10,20,9,5,7),taken=new Set(['/f/S.png']);const exists=async file=>taken.has(file);
  assert.equal(await O.uniqueOutputPath('/f','S',d,{extension:'.png',exists}),'/f/S-2.png');
  taken.add('/f/S-2.png');
  assert.equal(await O.uniqueOutputPath('/f','S',d,{extension:'.png',exists}),'/f/S-3.png');
  const t2=new Set(['/f/S_1.png']);
  assert.equal(await O.uniqueOutputPath('/f','S_<#>',d,{extension:'.png',exists:async file=>t2.has(file)}),'/f/S_2.png');
  await assert.rejects(O.uniqueOutputPath('/f','S',d,{extension:'.png',exists:async()=>true}),/A free filename could not be found/);
});
test('default folder follows user-dirs and spectaclerc',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{
    const home=path.join(root,'home'),configHome=path.join(root,'config');fs.mkdirSync(configHome);
    assert.equal(await O.defaultSaveFolder({home,configHome}),path.join(home,'Pictures','Screenshots'));
    fs.writeFileSync(path.join(configHome,'user-dirs.dirs'),'# c\nXDG_PICTURES_DIR="$HOME/Resimler"\n');
    fs.writeFileSync(path.join(configHome,'spectaclerc'),'[General]\nx=1\n\n[ImageSave]\ntranslatedScreenshotsFolder=Ekran Görüntüleri\n');
    assert.equal(await O.defaultSaveFolder({home,configHome}),path.join(home,'Resimler','Ekran Görüntüleri'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('format helpers',()=>{
  assert.equal(O.formatFromExtension('.JPEG'),'jpg');assert.equal(O.formatFromExtension('webp'),'webp');assert.equal(O.formatFromExtension('.gif'),null);
  assert.ok(O.matchesFormat(png,'png'));assert.ok(O.matchesFormat(jpeg,'jpg'));assert.ok(O.matchesFormat(webp,'webp'));assert.ok(!O.matchesFormat(png,'jpg'));
});
test('save writes a PNG copy and records it',()=>fixture(async({actions,store,item,calls})=>{
  const plan=await actions.plan(item.id,'save');
  assert.equal(plan.format,'png');
  const {path:file}=await actions.write(plan.token);
  assert.deepEqual(fs.readFileSync(file),fs.readFileSync(store.mediaPath(item.id)));
  assert.equal(store.item(item.id).savedPath,file);
  assert.equal(calls.notify.length,1);assert.match(calls.notify[0][0],/Saved as .* to /);assert.deepEqual(calls.notify[0][1],{file});
  await assert.rejects(actions.write(plan.token));
}));
test('plan rejects recordings and non-images',()=>fixture(async({actions,store,item})=>{
  const text=store.insert('text','hello');
  await assert.rejects(actions.plan(text.id,'save'));
  item.recording=true;await assert.rejects(actions.plan(item.id,'save'));
}));
test('write creates a missing unicode folder',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{await fixture(async({actions,item})=>{
    const plan=await actions.plan(item.id,'save');
    const {path:file}=await actions.write(plan.token);assert.ok(fs.existsSync(file));assert.ok(file.includes('Ekran Görüntüleri'));
  },{saveFolder:path.join(root,'a b','Ekran Görüntüleri')});}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('write rejects bad tokens and mismatched bytes',()=>fixture(async({actions,item,clock,store,folder})=>{
  await assert.rejects(actions.write('nope'));
  let plan=await actions.plan(item.id,'save');clock.time+=121000;await assert.rejects(actions.write(plan.token));
  store.data.settings.output.format='jpg';
  plan=await actions.plan(item.id,'save');assert.equal(plan.format,'jpg');
  await assert.rejects(actions.write(plan.token,url('image/jpeg',png)));
  plan=await actions.plan(item.id,'save');await assert.rejects(actions.write(plan.token));
  plan=await actions.plan(item.id,'save');await assert.rejects(actions.write(plan.token,url('image/png',jpeg)));
  assert.ok(!fs.existsSync(folder)||fs.readdirSync(folder).length===0);
  plan=await actions.plan(item.id,'save');
  const {path:file}=await actions.write(plan.token,url('image/jpeg',jpeg));assert.deepEqual(fs.readFileSync(file),jpeg);
}));
test('saveAs derives format from the chosen extension',()=>fixture(async({actions,item,state,calls,folder})=>{
  fs.mkdirSync(folder,{recursive:true});
  state.dialogResult={canceled:false,filePath:path.join(folder,'shot.JPEG')};
  let plan=await actions.plan(item.id,'saveAs');assert.equal(plan.format,'jpg');assert.equal(plan.path,path.join(folder,'shot.JPEG'));
  assert.ok(calls.dialog[0].defaultPath.startsWith(folder));assert.ok(calls.dialog[0].filters.length>=3);
  state.dialogResult={canceled:false,filePath:path.join(folder,'shot')};
  plan=await actions.plan(item.id,'saveAs');assert.equal(plan.format,'png');assert.equal(plan.path,path.join(folder,'shot.png'));
  state.dialogResult={canceled:true};assert.deepEqual(await actions.plan(item.id,'saveAs'),{canceled:true});
  fs.writeFileSync(path.join(folder,'shot.png'),'old');
  state.dialogResult={canceled:false,filePath:path.join(folder,'shot.png')};
  plan=await actions.plan(item.id,'saveAs');await actions.write(plan.token);
  assert.deepEqual(fs.readFileSync(path.join(folder,'shot.png')),png);
}));
test('save never overwrites an existing file',()=>fixture(async({actions,item,folder,store})=>{
  const plan=await actions.plan(item.id,'save');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(plan.path,'x');
  await assert.rejects(actions.write(plan.token));assert.equal(fs.readFileSync(plan.path,'utf8'),'x');
}));
test('ownsFile recognises written files by resolved path',()=>fixture(async({actions,item,clock})=>{
  const plan=await actions.plan(item.id,'save');const {path:file}=await actions.write(plan.token);
  assert.ok(actions.ownsFile(path.join(path.dirname(file),'.',path.basename(file))));
  assert.ok(!actions.ownsFile(path.join(path.dirname(file),'other.png')));
  clock.time+=31000;assert.ok(!actions.ownsFile(file));
}));
test('copyLocation needs a save until a file exists',()=>fixture(async({actions,item,calls})=>{
  assert.deepEqual(await actions.copyLocation(item.id),{needsSave:true});
  const plan=await actions.plan(item.id,'save');const {path:file}=await actions.write(plan.token);calls.notify.length=0;
  assert.deepEqual(await actions.copyLocation(item.id),{path:file});assert.deepEqual(calls.text,[file]);assert.equal(calls.notify[0][0],'File location copied');
  assert.deepEqual(await actions.revealSaved(item.id),{path:file});assert.deepEqual(calls.reveal,[file]);
  fs.unlinkSync(file);
  assert.deepEqual(await actions.copyLocation(item.id),{needsSave:true});assert.deepEqual(await actions.revealSaved(item.id),{needsSave:true});
}));
test('externalFile never returns the media path',()=>fixture(async({actions,item,store,runtimeDir})=>{
  const temp=path.join(runtimeDir,'clipboardline-output');
  fs.mkdirSync(temp,{recursive:true,mode:0o700});const stale=path.join(temp,'old.png');fs.writeFileSync(stale,'x');const old=new Date(Date.now()-7200000);fs.utimesSync(stale,old,old);
  const file=await actions.externalFile(item.id);
  assert.notEqual(file,store.mediaPath(item.id));assert.ok(file.startsWith(temp+path.sep));
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.deepEqual(fs.readFileSync(file),png);assert.ok(!fs.existsSync(stale));
  const plan=await actions.plan(item.id,'save');const {path:saved}=await actions.write(plan.token);
  assert.equal(await actions.externalFile(item.id),saved);
  await actions.cleanup();assert.ok(!fs.existsSync(temp));
}));
test('outputText resolves Turkish',()=>{
  assert.equal(O.outputText('tr','textCopied'),'Metin kopyalandı');
  assert.equal(O.outputText('en','saved','a.png','/x'),'Saved as a.png to /x');
  assert.equal(O.outputText('tr','saved','a.png','/x'),'a.png olarak /x klasörüne kaydedildi');
});
test('saveAs never overwrites a file the dialog did not confirm',()=>fixture(async({actions,item,state,folder})=>{
  fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'shot.png'),'old');
  for(const name of ['shot','shot.gif']){
    state.dialogResult={canceled:false,filePath:path.join(folder,name)};
    const plan=await actions.plan(item.id,'saveAs');assert.equal(plan.path,path.join(folder,name==='shot'?'shot.png':'shot.gif.png'));
    if(name==='shot')await assert.rejects(actions.write(plan.token));
    assert.equal(fs.readFileSync(path.join(folder,'shot.png'),'utf8'),'old');
  }
}));
test('externalFile refuses an unsafe temp folder',()=>fixture(async({actions,item,runtimeDir})=>{
  const temp=path.join(runtimeDir,'clipboardline-output');fs.mkdirSync(temp,{mode:0o700});fs.chmodSync(temp,0o777);
  await assert.rejects(actions.externalFile(item.id));
  fs.rmSync(temp,{recursive:true});fs.mkdirSync(path.join(runtimeDir,'elsewhere'));fs.symlinkSync(path.join(runtimeDir,'elsewhere'),temp);
  await assert.rejects(actions.externalFile(item.id));
}));
test('externalFile names are unique per call',()=>fixture(async({actions,item,store})=>{
  const other=Buffer.from(png);other[other.length-1]^=1;const second=store.insert('image',other);
  const a=await actions.externalFile(item.id),b=await actions.externalFile(second.id);
  assert.notEqual(a,b);assert.match(path.basename(a),/-[0-9a-f]{6}\.png$/);
}));
test('externalFile never overwrites or follows an existing temp entry',()=>fixture(async({actions,item,runtimeDir})=>{
  const temp=path.join(runtimeDir,'clipboardline-output');fs.mkdirSync(temp,{mode:0o700});
  const victim=path.join(runtimeDir,'victim');fs.writeFileSync(victim,'keep');
  const base='Screenshot_20261120_090507';
  fs.writeFileSync(path.join(temp,base+'-aaaaaa.png'),'planted');fs.symlinkSync(victim,path.join(temp,base+'-bbbbbb.png'));
  const names=['aaaaaa','bbbbbb','cccccc'];actions.suffix=()=>names.shift();
  const file=await actions.externalFile(item.id);
  assert.equal(path.basename(file),base+'-cccccc.png');assert.deepEqual(fs.readFileSync(file),png);assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.equal(fs.readFileSync(path.join(temp,base+'-aaaaaa.png'),'utf8'),'planted');assert.equal(fs.readFileSync(victim,'utf8'),'keep');
}));
test('saveAs rejects a relative dialog path',()=>fixture(async({actions,item,state})=>{
  state.dialogResult={canceled:false,filePath:'rel/shot.png'};await assert.rejects(actions.plan(item.id,'saveAs'),/Invalid save path/);
}));

// ---- Task 4: remaining actions ----
const {EventEmitter}=require('node:events');
const zlib=require('node:zlib');
const LANGS=[{code:'deu',name:{en:'German',tr:'Almanca'},source:'system',file:'/td/deu.traineddata'},{code:'eng',name:{en:'English',tr:'İngilizce'},source:'bundled',file:'/b/eng.gz'},{code:'tur',name:{en:'Turkish',tr:'Türkçe'},source:'bundled',file:'/b/tur.gz'}];
function fakeSpawn(calls,{fail=false}={}){
  return (command,args,options)=>{const child=new EventEmitter();child.unref=()=>{calls.unref=(calls.unref||0)+1;};calls.spawn.push({command,args,options});
    process.nextTick(()=>fail?child.emit('error',Object.assign(new Error('spawn '+command+' ENOENT'),{code:'ENOENT'})):child.emit('spawn'));return child;};
}
function fakeIntegration(calls,o={}){
  const real=require('../lib/desktop-integration.cjs');
  return {...real,
    imageApps:async options=>{calls.apps.push(options);return o.apps||[{id:'b.desktop',name:options.language==='tr'?'Bé':'B',file:'/apps/b.desktop'}];},
    ocrLanguages:async options=>{calls.langs.push(options);return o.languages||LANGS;},
    shareAvailable:async()=>{calls.share=(calls.share||0)+1;return o.share??true;},
    toolAvailable:async name=>{calls.tool.push(name);return o.zbar??true;},
    scanCodes:async file=>{calls.scan.push(file);if(o.scanError)throw o.scanError;return o.scan||{available:true,codes:[]};}};
}
function withFakes(o={}){
  return {extra:({calls,root})=>{Object.assign(calls,{spawn:[],apps:[],langs:[],tool:[],scan:[],ocr:[],print:[]});
    return {spawn:fakeSpawn(calls,o),assetsDir:path.join(root,'assets'),integration:fakeIntegration(calls,o),env:{PATH:'/nowhere'},ocrBundledDir:'/bundled',
      ocr:async(id,languages)=>{calls.ocr.push([id,languages]);return {text:o.ocrText??'Hallo'};},
      print:async file=>{calls.print.push(file);return {printed:true};}};},language:o.language};
}
test('openWith launches only listed apps with a non-media file',()=>fixture(async({actions,item,store,calls,runtimeDir})=>{
  await actions.openWith(item.id,'b.desktop');
  assert.equal(calls.spawn.length,1);const [run]=calls.spawn;
  assert.equal(run.command,'gio');assert.deepEqual(run.args.slice(0,2),['launch','/apps/b.desktop']);
  assert.notEqual(run.args[2],store.mediaPath(item.id));assert.ok(run.args[2].startsWith(path.join(runtimeDir,'clipboardline-output')+path.sep));
  assert.equal(run.options.detached,true);assert.equal(run.options.stdio,'ignore');assert.equal(calls.unref,1);
  await assert.rejects(actions.openWith(item.id,'evil.desktop'),/not available/);assert.equal(calls.spawn.length,1);
  const plan=await actions.plan(item.id,'save');const {path:saved}=await actions.write(plan.token);
  await actions.openWith(item.id,'b.desktop');assert.equal(calls.spawn[1].args[2],saved);
},withFakes()));
test('openWith reports a launcher that cannot start',()=>fixture(async({actions,item})=>{
  await assert.rejects(actions.openWith(item.id,'b.desktop'),/ENOENT/);
},withFakes({fail:true})));
test('extractText copies recognized text with chosen languages',()=>fixture(async({actions,item,calls})=>{
  assert.deepEqual(await actions.extractText(item.id,['deu']),{text:'Hallo'});
  assert.deepEqual(calls.ocr,[[item.id,['deu']]]);assert.deepEqual(calls.text,['Hallo']);assert.equal(calls.notify.at(-1)[0],'Text copied');
  await actions.extractText(item.id);assert.deepEqual(calls.ocr[1][1],['eng','tur'],'defaults come from settings');
  await assert.rejects(actions.extractText(item.id,['xyz']),/Invalid OCR languages/);
  await assert.rejects(actions.extractText(item.id,[]),/Invalid OCR languages/);
  await assert.rejects(actions.extractText(item.id,'eng'),/Invalid OCR languages/);
  await assert.rejects(actions.extractText(item.id,Array(17).fill('eng')),/Invalid OCR languages/);
  assert.equal(calls.ocr.length,2);
},withFakes()));
test('extractText reports empty text without writing',()=>fixture(async({actions,item,calls,store})=>{
  assert.deepEqual(await actions.extractText(item.id,['eng']),{text:''});
  assert.deepEqual(calls.text,[]);assert.equal(calls.notify.at(-1)[0],'No text found');
  store.data.settings.output.ocrLanguages=['chi_sim','deu'];await actions.extractText(item.id);assert.deepEqual(calls.ocr.at(-1)[1],['deu'],'uninstalled defaults are skipped');
},withFakes({ocrText:'  \n'})));
test('scanCode copies the first text code',()=>fixture(async({actions,item,calls})=>{
  const result=await actions.scanCode(item.id);
  assert.equal(result.codes.length,2);assert.deepEqual(calls.text,['https://a.example/'+'x'.repeat(100)]);
  assert.match(calls.notify.at(-1)[0],/2 codes found/);assert.ok(calls.notify.at(-1)[0].length<140,'preview is cut');
  assert.ok(calls.scan[0].includes('clipboardline-output'),'zbarimg reads a temp copy');
},withFakes({scan:{available:true,codes:[{type:'QR-Code',text:'https://a.example/'+'x'.repeat(100),binary:false},{type:'EAN-13',text:'123',binary:false}]}})));
test('scanCode with a single code',()=>fixture(async({actions,item,calls})=>{
  await actions.scanCode(item.id);assert.equal(calls.notify.at(-1)[0],'Code found: hi (copied)');
},withFakes({scan:{available:true,codes:[{type:'QR-Code',text:'hi',binary:false}]}})));
test('scanCode binary only',()=>fixture(async({actions,item,calls})=>{
  await actions.scanCode(item.id);assert.deepEqual(calls.text,[]);assert.equal(calls.notify.at(-1)[0],'Code found with binary content');
},withFakes({scan:{available:true,codes:[{type:'QR-Code',text:null,binary:true}]}})));
test('scanCode none',()=>fixture(async({actions,item,calls})=>{
  assert.deepEqual(await actions.scanCode(item.id),{codes:[]});assert.deepEqual(calls.text,[]);assert.equal(calls.notify.at(-1)[0],'No QR code or barcode found');
},withFakes()));
test('scanCode surfaces tool failures as short errors',()=>fixture(async({actions,item,calls})=>{
  await assert.rejects(actions.scanCode(item.id),error=>/QR code scan failed: timed out/.test(error.message));assert.deepEqual(calls.text,[]);
},withFakes({scanError:Object.assign(new Error('Command failed: zbarimg\nlong stderr'),{killed:true,signal:'SIGTERM'})})));
test('scanCode reports a missing zbarimg',()=>fixture(async({actions,item})=>{
  await assert.rejects(actions.scanCode(item.id),/zbarimg/);
},withFakes({scan:{available:false,codes:[]}})));
test('share spawns qml6 with the share script',()=>fixture(async({actions,item,calls,root})=>{
  await actions.share(item.id);
  const [run]=calls.spawn;assert.equal(run.command,'qml6');
  assert.equal(run.args.length,4);assert.deepEqual(run.args.slice(0,3),[path.join(root,'assets','share.qml'),'--','image/png']);assert.ok(run.args[3].endsWith('.png'));
  assert.equal(run.options.detached,true);assert.equal(run.options.stdio,'ignore');
  const qml=fs.readFileSync(path.join(__dirname,'..','assets','share.qml'),'utf8');
  for(const part of ['ApplicationWindow','AlternativesView','pluginType: "Export"','mimeType: root.mime','Qt.quit()','Paylaş','420','520'])assert.ok(qml.includes(part),part);
},withFakes()));
test('share refuses when Purpose is unavailable',()=>fixture(async({actions,item,calls})=>{
  await assert.rejects(actions.share(item.id),/Sharing is unavailable/);assert.equal(calls.spawn.length,0);
},withFakes({share:false})));
test('print hands a non-media file to the injected printer',()=>fixture(async({actions,item,calls,store})=>{
  assert.deepEqual(await actions.printImage(item.id),{printed:true});
  assert.equal(calls.print.length,1);assert.notEqual(calls.print[0],store.mediaPath(item.id));assert.ok(fs.existsSync(calls.print[0]));
},withFakes()));
test('info reports apps, languages and availability',()=>fixture(async({actions,calls,clock,folder})=>{
  const info=await actions.info();
  assert.deepEqual(info,{defaultFolder:folder,formats:['png','jpg','webp'],format:'png',apps:[{id:'b.desktop',name:'Bé'}],
    languages:[{code:'deu',name:'Almanca'},{code:'eng',name:'İngilizce'},{code:'tur',name:'Türkçe'}],defaultLanguages:['eng','tur'],shareAvailable:true,codeAvailable:true});
  assert.equal(calls.apps[0].language,'tr');assert.equal(calls.langs[0].bundledDir,'/bundled');assert.deepEqual(calls.tool,['zbarimg']);
  await actions.info();assert.equal(calls.apps.length,1,'apps cached');assert.equal(calls.share,1);assert.equal(calls.tool.length,1);
  clock.time+=61000;await actions.info();assert.equal(calls.apps.length,2,'apps refreshed after 60 s');assert.equal(calls.share,1,'availability cached for the process');
},{...withFakes(),language:'tr'}));
test('info uses the default folder when none is set',()=>fixture(async({actions,store,root})=>{
  store.data.settings.output.saveFolder='';
  assert.equal((await actions.info()).defaultFolder,path.join(root,'home','Pictures','Screenshots'));
},withFakes()));
test('run validates the action, item, app and languages',()=>fixture(async({actions,item,calls})=>{
  await assert.rejects(actions.run({id:'nope',action:'copyLocation'}),/Invalid item selection/);
  await assert.rejects(actions.run({id:item.id,action:'format'}),/Unknown output action/);
  await assert.rejects(actions.run({id:item.id,action:'openWith'}),/not available/);
  await assert.rejects(actions.run({id:item.id,action:'openWith',app:'../../x.desktop'}),/not available/);
  await assert.rejects(actions.run({id:item.id,action:'extractText',languages:['eng','../x']}),/Invalid OCR languages/);
  assert.deepEqual(await actions.run({id:item.id,action:'copyLocation'}),{needsSave:true});
  assert.deepEqual(await actions.run({id:item.id,action:'reveal'}),{needsSave:true});
  assert.deepEqual(await actions.run({id:item.id,action:'extractText',languages:['tur']}),{text:'Hallo'});assert.deepEqual(calls.ocr.at(-1)[1],['tur']);
  await actions.run({id:item.id,action:'openWith',app:'b.desktop'});assert.equal(calls.spawn.length,1);
  await actions.run({id:item.id,action:'print'});assert.equal(calls.print.length,1);
  await actions.run({id:item.id,action:'share'});await actions.run({id:item.id,action:'scanCode'});assert.equal(calls.scan.length,1);
  await assert.rejects(actions.plan('nope','save'),/Invalid item selection/);
},withFakes()));
test('ownsFile also recognises the real path behind a symlinked folder',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{
    const real=path.join(root,'real');fs.mkdirSync(real);const link=path.join(root,'link');fs.symlinkSync(real,link);
    await fixture(async({actions,item})=>{
      const plan=await actions.plan(item.id,'save');const {path:file}=await actions.write(plan.token);
      assert.ok(file.startsWith(link));assert.ok(actions.ownsFile(file));assert.ok(actions.ownsFile(path.join(real,path.basename(file))));
    },{saveFolder:link});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a failed write is not remembered as owned',()=>fixture(async({actions,item,folder})=>{
  const plan=await actions.plan(item.id,'save');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(plan.path,'x');
  await assert.rejects(actions.write(plan.token));assert.ok(!actions.ownsFile(plan.path));
}));
test('prepareOcrLanguages copies bundled files and gzips system tessdata once',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{
    const bundled=path.join(root,'eng.traineddata.gz');fs.writeFileSync(bundled,zlib.gzipSync(Buffer.from('ENG')));
    const system=path.join(root,'deu.traineddata');fs.writeFileSync(system,'DEU-DATA');
    const directory=path.join(root,'models');let listed=0;
    const available=async()=>{listed++;return [{code:'eng',source:'bundled',file:bundled},{code:'deu',source:'system',file:system}];};
    await O.prepareOcrLanguages({languages:['eng','deu'],directory,available});
    assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(directory,'eng.traineddata.gz'))).toString(),'ENG');
    assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(directory,'deu.traineddata.gz'))).toString(),'DEU-DATA');
    assert.deepEqual(fs.readdirSync(directory).sort(),['deu.traineddata.gz','eng.traineddata.gz'],'no temp files left');
    fs.writeFileSync(system,'CHANGED');
    await O.prepareOcrLanguages({languages:['eng','deu'],directory,available});
    assert.equal(listed,1,'existing files skip discovery');
    assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(directory,'deu.traineddata.gz'))).toString(),'DEU-DATA');
    await assert.rejects(O.prepareOcrLanguages({languages:['fra'],directory,available}),/OCR language is not installed: fra/);
    await assert.rejects(O.prepareOcrLanguages({languages:['../x'],directory,available}),/Invalid OCR language/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('announcer toasts when visible and notifies the desktop when hidden',()=>{
  const toasts=[],shown=[],revealed=[];let visible=true;
  class FakeNotification extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;}show(){shown.push(this);}}
  const announce=O.createAnnouncer({visible:()=>visible,toast:text=>toasts.push(text),Notification:FakeNotification,testMode:false,reveal:file=>revealed.push(file)});
  announce('One',{file:'/x/a.png'});assert.deepEqual(toasts,['One']);assert.equal(shown.length,0);
  visible=false;announce('Two',{file:'/x/b.png'});assert.equal(shown.length,1);
  assert.deepEqual(shown[0].options,{title:'ClipBoardLine',body:'Two',silent:true});
  shown[0].emit('click');assert.deepEqual(revealed,['/x/b.png']);
  announce('Three');shown[1].emit('click');assert.deepEqual(revealed,['/x/b.png'],'no file, no reveal');
  const quiet=O.createAnnouncer({visible:()=>false,toast:text=>toasts.push(text),Notification:FakeNotification,testMode:true,reveal:()=>{}});
  quiet('Four');assert.equal(shown.length,2,'never a desktop notification in test mode');assert.equal(toasts.at(-1),'Four');
  class Unsupported extends FakeNotification{static isSupported(){return false;}}
  O.createAnnouncer({visible:()=>false,toast:text=>toasts.push(text),Notification:Unsupported,testMode:false,reveal:()=>{}})('Five');
  assert.equal(shown.length,2);assert.equal(toasts.at(-1),'Five');
});
function fakeWindowClass(log,{loadFails=false,printResult=[true,'']}={}){
  return class{constructor(options){this.options=options;log.windows.push(this);this.destroyed=false;
      this.webContents={print:(options,callback)=>{log.print.push(options);setImmediate(()=>callback(...printResult));}};}
    async loadFile(file){log.loaded.push(file);if(loadFails)throw new Error('load failed');}
    destroy(){this.destroyed=true;}isDestroyed(){return this.destroyed;}};
}
test('printWithWindow loads a sandboxed script-free page beside the image',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{
    const directory=path.join(root,'tmp');fs.mkdirSync(directory,{mode:0o700});const image=path.join(directory,'Shot "a" <b> #1.png');fs.writeFileSync(image,png);
    const log={windows:[],print:[],loaded:[]};
    assert.deepEqual(await O.printWithWindow(image,{BrowserWindow:fakeWindowClass(log),directory}),{printed:true});
    const [win]=log.windows;
    assert.equal(win.options.show,false);
    assert.deepEqual(win.options.webPreferences,{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false});
    assert.ok(!('preload' in win.options.webPreferences));
    assert.ok(win.destroyed,'window destroyed in the print callback');
    assert.deepEqual(log.print,[{silent:false,printBackground:true}]);
    const html=fs.readFileSync(log.loaded[0],'utf8');
    assert.equal(path.dirname(log.loaded[0]),directory);assert.equal(fs.statSync(log.loaded[0]).mode&0o777,0o600);
    assert.match(html,/max-width:100%;max-height:100vh;object-fit:contain/);assert.match(html,/@page\{margin:10mm\}/);
    assert.ok(html.includes(require('node:url').pathToFileURL(image).href.replace(/&/g,'&amp;').replace(/"/g,'&quot;')));
    assert.doesNotMatch(html,/<script/i);assert.ok(!html.includes('<b>'),'file name is escaped');
    const cancelled={windows:[],print:[],loaded:[]};
    assert.deepEqual(await O.printWithWindow(image,{BrowserWindow:fakeWindowClass(cancelled,{printResult:[false,'cancelled']}),directory}),{printed:false});
    const failed={windows:[],print:[],loaded:[]};
    await assert.rejects(O.printWithWindow(image,{BrowserWindow:fakeWindowClass(failed,{printResult:[false,'failed']}),directory}),/Printing failed/);
    assert.ok(failed.windows[0].destroyed);
    const broken={windows:[],print:[],loaded:[]};
    await assert.rejects(O.printWithWindow(image,{BrowserWindow:fakeWindowClass(broken,{loadFails:true}),directory}),/load failed/);
    assert.ok(broken.windows[0].destroyed,'window destroyed when loading fails');assert.equal(broken.print.length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// ---- Final review fixes ----
const editedPng=()=>{const other=Buffer.from(png);other[other.length-5]^=1;return other;};
test('a Library edit makes the saved file stale: no savedFile, fresh temp copy',()=>fixture(async({actions,item,store,runtimeDir})=>{
  const plan=await actions.plan(item.id,'save');const {path:saved}=await actions.write(plan.token);
  assert.equal(await actions.savedFile(item.id),saved);
  const edited=editedPng();store.modify('saveImage',{id:item.id,dataUrl:'data:image/png;base64,'+edited.toString('base64')});
  assert.equal(await actions.savedFile(item.id),null,'the pre-edit file is no longer this item');
  const file=await actions.externalFile(item.id);
  assert.notEqual(file,saved);assert.ok(file.startsWith(path.join(runtimeDir,'clipboardline-output')+path.sep));assert.deepEqual(fs.readFileSync(file),edited);
  assert.deepEqual(await actions.copyLocation(item.id),{needsSave:true});
}));
test('handle announces plan and write failures as save failures',()=>fixture(async({actions,item,calls,folder})=>{
  await assert.rejects(actions.handle('outputWrite',{token:'nope'}),error=>error.announced===true&&/^Görsel kaydedilemedi: /.test(error.message));
  assert.match(calls.notify.at(-1)[0],/^Görsel kaydedilemedi: /);
  const plan=await actions.handle('outputPlan',{id:item.id,mode:'save'});fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(plan.path,'x');
  await assert.rejects(actions.handle('outputWrite',{token:plan.token}),error=>error.announced&&/zaten var/.test(error.message)&&!/EEXIST/.test(error.message));
  await assert.rejects(actions.handle('outputPlan',{id:item.id,mode:'bogus'}),error=>error.announced&&/^Görsel kaydedilemedi/.test(error.message));
  const before=calls.notify.length;
  assert.equal(typeof (await actions.handle('outputInfo')).formats,'object');assert.equal(calls.notify.length,before);
},{...withFakes(),language:'tr'}));
test('handle announces run failures as action failures',()=>fixture(async({actions,item,calls})=>{
  await assert.rejects(actions.handle('outputRun',{id:item.id,action:'share'}),error=>error.announced&&error.message==='İşlem başarısız oldu: Paylaşım kullanılamıyor');
  assert.equal(calls.notify.at(-1)[0],'İşlem başarısız oldu: Paylaşım kullanılamıyor');
  assert.equal(calls.spawn.length,0);
},{...withFakes({share:false}),language:'tr'}));
test('handle outputFailed announces a short renderer failure',()=>fixture(async({actions,calls,item})=>{
  assert.deepEqual(await actions.handle('outputFailed',{message:'The original image could not be opened.'}),{announced:true});
  assert.equal(calls.notify.at(-1)[0],'The image could not be saved: The original image could not be opened.');
  const plan=await actions.plan(item.id,'save');assert.equal(actions.tokens.size,1);
  await actions.handle('outputFailed',{message:'Encode failed',token:plan.token});assert.equal(actions.tokens.size,0,'the failed plan releases its path');
  for(const message of [undefined,42,'','x'.repeat(301)])await assert.rejects(actions.handle('outputFailed',{message}),/Invalid failure message/);
  await assert.rejects(actions.handle('outputNope',{}),/Unknown output command/);
}));
test('errors are Turkish in a Turkish UI',()=>fixture(async({actions,item})=>{
  await assert.rejects(actions.openWith(item.id,'evil.desktop'),/Bu uygulama görseller için kullanılamıyor/);
  await assert.rejects(actions.share(item.id),/Paylaşım kullanılamıyor/);
},{...withFakes({share:false}),language:'tr'}));
test('scan errors are Turkish in a Turkish UI',()=>fixture(async({actions,item})=>{
  await assert.rejects(actions.scanCode(item.id),/QR kod taraması başarısız oldu: zaman aşımı/);
},{...withFakes({scanError:Object.assign(new Error('x'),{killed:true})}),language:'tr'}));
test('missing zbarimg is Turkish in a Turkish UI',()=>fixture(async({actions,item})=>{
  await assert.rejects(actions.scanCode(item.id),/QR kod taraması için zbarimg \(zbar\) kurulmalı/);
},{...withFakes({scan:{available:false,codes:[]}}),language:'tr'}));
test('missing OCR languages are Turkish in a Turkish UI',()=>fixture(async({actions,item,store})=>{
  store.data.settings.output.ocrLanguages=['chi_sim'];await assert.rejects(actions.extractText(item.id),/Kurulu OCR dili yok/);
},{...withFakes(),language:'tr'}));
test('print failures are translated',()=>fixture(async({actions,item})=>{
  await assert.rejects(actions.printImage(item.id),/Yazdırma başarısız oldu: failed/);
},{extra:()=>({print:async()=>{throw Object.assign(new Error('Printing failed: failed'),{code:'EPRINT',reason:'failed'});}}),language:'tr'}));
test('describeError maps file errors and print timeouts',()=>{
  assert.equal(O.describeError('en',Object.assign(new Error('EACCES: permission denied'),{code:'EACCES'})),'Permission denied');
  assert.equal(O.describeError('tr',Object.assign(new Error('x'),{code:'ENOSPC'})),'Diskte yer kalmadı');
  assert.equal(O.describeError('tr',Object.assign(new Error('x'),{code:'EPRINT',reason:'timeout'})),'Yazdırma zaman aşımına uğradı');
  assert.equal(O.describeError('en',new Error('Plain')),'Plain');
  assert.equal(O.outputText('tr','libraryFailed','x'),'Ekran görüntüsü Kütüphane’ye kaydedilemedi: x');
  assert.equal(O.outputText('en','libraryFailedCopied','x'),'Screenshot copied, but it could not be saved to the Library: x');
  assert.equal(O.outputText('en','actionFailed','x'),'The action failed: x');
});
test('two pending plans never get the same path',()=>fixture(async({actions,item,clock,store})=>{
  store.data.settings.output.filenameTemplate='Shot';
  const a=await actions.plan(item.id,'save'),b=await actions.plan(item.id,'save');
  assert.notEqual(a.path,b.path);assert.ok(b.path.endsWith('-2.png'));
  await actions.write(a.token);await actions.write(b.token);
  const c=await actions.plan(item.id,'save');assert.ok(c.path.endsWith('-3.png'));
  clock.time+=121000;const d=await actions.plan(item.id,'save');assert.equal(d.path,c.path,'an expired plan no longer holds its path');
}));
test('plan prunes expired tokens',()=>fixture(async({actions,item,clock})=>{
  await actions.plan(item.id,'save');await actions.plan(item.id,'save');assert.equal(actions.tokens.size,2);
  clock.time+=121000;await actions.plan(item.id,'save');assert.equal(actions.tokens.size,1);
}));
test('share passes the MIME type of the shared file',()=>fixture(async({actions,item,calls,store})=>{
  await actions.share(item.id);assert.deepEqual(calls.spawn[0].args.slice(1,3),['--','image/png']);assert.ok(calls.spawn[0].args[3].endsWith('.png'));assert.equal(calls.spawn[0].args.length,4);
  store.data.settings.output.format='jpg';const plan=await actions.plan(item.id,'save');await actions.write(plan.token,url('image/jpeg',jpeg));
  await actions.share(item.id);assert.deepEqual(calls.spawn[1].args.slice(1),['--','image/jpeg',plan.path]);
  const qml=fs.readFileSync(path.join(__dirname,'..','assets','share.qml'),'utf8');
  assert.ok(!qml.includes('mimeType: "image/png"'),'no hard-coded MIME type');assert.match(qml,/mimeType: root\.mime/);assert.match(qml,/args\[args\.length - 2\]/);
},withFakes()));
test('printWithWindow gives up after its timeout and destroys the window',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-output-test-'));
  try{
    const directory=path.join(root,'tmp');fs.mkdirSync(directory,{mode:0o700});const image=path.join(directory,'a.png');fs.writeFileSync(image,png);
    const log={windows:[],print:[],loaded:[]};
    const Hanging=class extends fakeWindowClass(log){constructor(options){super(options);this.webContents={print:options=>{log.print.push(options);}};}};
    await assert.rejects(O.printWithWindow(image,{BrowserWindow:Hanging,directory,timeout:20}),error=>error.code==='EPRINT'&&error.reason==='timeout');
    assert.ok(log.windows[0].destroyed);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('announcer keeps desktop notifications alive until they finish',async()=>{
  const shown=[],revealed=[],timers=[];
  class FakeNotification extends EventEmitter{static isSupported(){return true;}show(){shown.push(this);}}
  const announce=O.createAnnouncer({visible:()=>false,toast:()=>{},Notification:FakeNotification,testMode:false,reveal:file=>revealed.push(file),
    setTimer:(fn,ms)=>{const timer={fn,ms,unref(){this.unrefed=true;}};timers.push(timer);return timer;},clearTimer:timer=>{timer.cleared=true;}});
  announce('A',{file:'/x/a.png'});announce('B');announce('C');
  assert.equal(announce.live.size,3);assert.equal(timers[0].ms,60000);assert.ok(timers.every(timer=>timer.unrefed));
  shown[0].emit('click');assert.deepEqual(revealed,['/x/a.png']);assert.equal(announce.live.size,2);assert.ok(timers[0].cleared);
  shown[1].emit('close');shown[1].emit('failed');assert.equal(announce.live.size,1);
  timers[2].fn();assert.equal(announce.live.size,0);
});
