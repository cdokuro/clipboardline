'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Store}=require('../lib/model.cjs');
const O=require('../lib/output-actions.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(16)]);
const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8 '),Buffer.alloc(8)]);
const url=(mime,buffer)=>`data:${mime};base64,${buffer.toString('base64')}`;

async function fixture(fn,{saveFolder,language='en'}={}){
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
      writeText:async text=>{calls.text.push(text);},reveal:file=>{calls.reveal.push(file);},notify:(text,extra)=>{calls.notify.push([text,extra]);}});
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
