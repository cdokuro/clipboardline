'use strict';
const {app,BrowserWindow,ipcMain,clipboard,ClipboardItem,nativeImage,protocol,net,Tray,Menu,Notification,powerMonitor,globalShortcut,screen,desktopCapturer,dialog,shell} = require('electron');
// Electron's protocol.handle and net.fetch construct these globals lazily.
// Finish Node/Undici initialization before renderer/protocol callbacks can
// re-enter it during the first managed image request in an installed build.
const {Request:WebRequest,Response:WebResponse,Headers:WebHeaders}=globalThis;
for(const [name,constructor]of Object.entries({Request:WebRequest,Response:WebResponse,Headers:WebHeaders})){
  if(typeof constructor!=='function')throw new Error('Web API initialization failed: '+name);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{value:constructor,writable:true,configurable:true,enumerable:descriptor?.enumerable??false});
}
new WebRequest('https://example.invalid/');new WebResponse(null,{headers:new WebHeaders()});
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {spawn, execFile} = require('node:child_process');
const {Store,plainURL,ids} = require('./lib/model.cjs');
const {privateClipboard,readClipboardContent}=require('./lib/clipboard-policy.cjs');
const {mediaOrigin}=require('./lib/media-policy.cjs');
const {mediaResponse,mediaGenerationMatches}=require('./lib/media-response.cjs');
const {MediaJobs,MAXIMUM_VIDEO_BYTES}=require('./lib/media.cjs');
const {copyFiles,cancelFileCopies}=require('./lib/native-files.cjs');
const {exportCopies}=require('./lib/export-copies.cjs');
const {decodeTextFile}=require('./lib/text-file.cjs');
const native = require('./lib/native.cjs');
const {PasteTargetTracker}=require('./lib/paste-target.cjs');
const {DragFiles}=require('./lib/drag-files.cjs');
const {thumbnailFetch,linkMetadata} = require('./lib/network.cjs');
const {Updates,AutomaticUpdateScheduler} = require('./lib/updates.cjs');
const {GitHubUpdates} = require('./lib/github-updates.cjs');
const {updatesSupported,publicUpdateState}=require('./lib/update-channel.cjs');
const productionOverride = process.argv.includes('--production') || process.env.CLIPBOARDLINE_PRODUCTION === '1';
if(productionOverride && !app.isPackaged) process.env.CLIPBOARDLINE_DISABLE_UPDATES = '1';
const UPDATES_SUPPORTED=updatesSupported(process.platform);
const {GlobalShortcuts,createLinuxShortcutRegistry}=require('./lib/global-shortcuts.cjs');
const {ImageSearch,modelPaths}=require('./lib/image-search.cjs');
const {createOcrQueue}=require('./lib/ocr-queue.cjs');
const {StatusTray,trayIcon,translated}=require('./lib/status-summary.cjs');
const {WindowBounds}=require('./lib/window-bounds.cjs');
const {MotionBridge}=require('./lib/shelf-motion.cjs');
const {OutputActions,prepareOcrLanguages,createAnnouncer,printWithWindow,outputText,describeError}=require('./lib/output-actions.cjs');
const OUTPUT_COMMANDS=new Set(['outputInfo','outputPlan','outputWrite','outputRun','outputFailed']);
const BUILD_NUMBER=Number(require('./package.json').clipboardLineBuild)||63;
const testMode = process.argv.includes('--test-mode');
const testFolder = process.argv.find(value=>value.startsWith('--test-data='))?.slice('--test-data='.length);
const testTray=testMode&&!!testFolder&&process.argv.includes('--test-tray');
if(testMode && testFolder) app.setPath('userData',path.resolve(testFolder));
const development=!app.isPackaged&&!testMode&&!productionOverride;
if(development){const directory=path.join(app.getPath('appData'),'ClipBoardLine Dev');fs.mkdirSync(directory,{recursive:true,mode:0o700});app.setPath('userData',directory);}
else if(productionOverride&&!app.isPackaged){const directory=path.join(app.getPath('appData'),'ClipBoardLine');fs.mkdirSync(directory,{recursive:true,mode:0o700});app.setPath('userData',directory);}
if(process.platform==='linux'&&!testMode&&process.env.WAYLAND_DISPLAY){
  app.commandLine.appendSwitch('ozone-platform','wayland');
}
// The tray app stays resident. Host network service in-process and trim unused
// Chromium media/router features to keep background RAM footprint lightweight.
app.commandLine.appendSwitch('enable-features','NetworkServiceInProcess2');
if(process.platform==='win32'){
  app.commandLine.appendSwitch('disable-features','HardwareMediaKeyHandling,MediaRouter,CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('js-flags','--max-old-space-size=192');
}
app.setName(development?'ClipBoardLine Dev':'ClipBoardLine');
protocol.registerSchemesAsPrivileged([{scheme:'appmedia',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let window,store,tray,trayPresentation,updates,githubUpdates,updateScheduler,monitor,clipboardTimer,retentionTimer,updateTimer,updateLaunchTimer,previous=null,view='shelves',message='',viewEvent=null;
let lastFingerprint='',ownFingerprint='',showing=0,closing=false,watchers=[],normalBounds=null,normalMaximized=false,applyingBounds=false;
const clipboardQueue=[];let processingClipboard=false;
let pastePromise=null,hidePromise=null,pasteGeneration=0;
let lastBroadcastLibraryRevision=-1,windowSurface=null,pendingCapture=null,lastClickDisplayId=null;
const captureReadyWaiters=new Map();
function waitForCaptureReady(captureId,timeoutMs=350){
  if(!captureId)return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>{const entry=captureReadyWaiters.get(captureId);if(entry){clearTimeout(entry.timer);captureReadyWaiters.delete(captureId);}resolve();};
    const timer=setTimeout(done,timeoutMs);
    timer.unref?.();
    captureReadyWaiters.set(captureId,{done,timer});
  });
}
let visibilityGeneration=0,desiredVisible=false;
const shelfMotion=new MotionBridge(value=>{if(window&&!window.isDestroyed())window.webContents.send('clipboardline:shelf-motion',value);});
const windowBounds=new WindowBounds();
const pasteTargets=new PasteTargetTracker(process.pid);
const entry = pathToFileURL(path.join(__dirname,'index.html')).href;
const copyMarker = crypto.randomBytes(16);
const pending = new Map();
const ocrJobs=new Map();
const {queue:ocrQueue,queueOCR}=createOcrQueue({
 enabled:()=>!testMode&&!!store?.data.settings.indexImages,
 closing:()=>closing,
 process:async next=>{
  const item=store.data.items.find(i=>i.id===next);if(!item||item.trashedAt||item.ocrText)return;
  const fingerprint=item.renderedFile||item.imageFile;try{await ocr(next,true);}catch(err){console.warn('Background OCR queue error:',err?.message||err);}
  if(store.data.items.includes(item)&&(item.renderedFile||item.imageFile)!==fingerprint)queueOCR(next);
 }
});
const mediaDiagnostics=[];
let imageSearch,imageSearchTimer,dragFiles,mediaJobs,output;
const recordingTrims=new Map();
function cancelRecordingTrims(){for(const controller of recordingTrims.values())controller.abort();}
function cancelNativePaste(){native.cancelPaste();cancelFileCopies();}
function refreshImageSearch(){if(!imageSearch||closing)return;clearTimeout(imageSearchTimer);imageSearchTimer=setTimeout(()=>imageSearch.refresh(),400);imageSearchTimer.unref?.();}
async function readSemanticImage(id){
 const file=store.posterPath(id),header=Buffer.alloc(24);let descriptor;
 try{descriptor=fs.openSync(file,'r');if(fs.readSync(descriptor,header,0,24,0)!==24)return null;}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
 const width=header.readUInt32BE(16),height=header.readUInt32BE(20),scale=Math.min(1,1024/Math.max(width,height));
 if(!width||!height||width*height>80_000_000||Math.min(width,height)*scale<120||Math.max(width,height)/Math.min(width,height)>4)return null;
 // Electron delegates thumbnail decoding to the OS asynchronously. Inference
 // and pixel conversion stay in the worker, keeping large PNGs off the UI loop.
 let image=await nativeImage.createThumbnailFromPath(file,{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});if(image.isEmpty())return null;
 const size=image.getSize(),fit=Math.min(1,1024/Math.max(size.width,size.height));if(fit<1)image=image.resize({width:Math.max(1,Math.round(size.width*fit)),height:Math.max(1,Math.round(size.height*fit)),quality:'best'});
 const resized=image.getSize();return{bitmap:image.toBitmap(),width:resized.width,height:resized.height};
}

function currentUpdatePacket(){
  if(UPDATES_SUPPORTED&&!development&&updates)return publicUpdateState(updates.state,process.platform);
  if(githubUpdates)return {...githubUpdates.state};
  return publicUpdateState(updates?.state||{},process.platform);
}
function state(result,{surfaceOnly=false}={}) { const light=surfaceOnly&&lastBroadcastLibraryRevision===store.revision;return {...(light?{surfaceOnly:true}:store.publicState()),libraryRevision:store.revision,version:app.getVersion(),build:BUILD_NUMBER,platform:process.platform,development,view,windowMode:(view==='shelves'||view==='capture')?'overlay':'normal',windowMaximized:window?.isMaximized()||false,windowVisible:desiredVisible&&(window?.isVisible()||false),shortcutRecordingToken:shortcutRecording?.token||null,pendingCapture:pendingCapture?{id:pendingCapture.id,dataUrl:pendingCapture.dataUrl,width:pendingCapture.width,height:pendingCapture.height}:null,message:message||store.privacyWarning||'',viewEvent,imageSearch:{...(imageSearch?.state||{available:false,indexing:false,pending:0,revision:0})},update:currentUpdatePacket(),...(result===undefined?{}:{result})}; }
function broadcast({surfaceOnly=false}={}) {
  // Visibility and native bounds do not change library content. Retain the
  // renderer's existing rows instead of cloning and sending the full history
  // for every hide/show/resize packet. A committed store change forces a full
  // snapshot before subsequent surface packets can reuse it.
  const packet=state(undefined,{surfaceOnly});if(!packet.surfaceOnly)refreshTray();
  if(window&&!window.isDestroyed()){window.webContents.send('clipboardline:changed',packet);if(!packet.surfaceOnly)lastBroadcastLibraryRevision=store.revision;}
  return packet;
}
function notify(text) { message=text;broadcast(); }
// Output-action feedback: toast while the window is up, desktop notification while hidden.
// Output-action texts follow the UI language (settings.language, or the system locale).
function outputLanguage(){const value=store?.data?.settings?.language||'system';return /^tr/i.test(value==='system'?app.getLocale():value)?'tr':'en';}
const announce=createAnnouncer({visible:()=>desiredVisible&&!!window?.isVisible(),toast:notify,Notification,testMode,reveal:file=>shell.showItemInFolder(file)});
function openUpdates(){return show('settings',{settingsTab:'updates'});}
function refreshTray(){
  if(closing||!tray||tray.isDestroyed()||!trayPresentation||!store)return;
  const availVer = UPDATES_SUPPORTED ? updates?.manifest?.version : githubUpdates?.manifest?.version;
  trayPresentation.refresh({items:store.data.items,settings:store.data.settings,updateVersion:availVer,systemLocale:app.getLocale()});
}
function createTray(){
  if(tray)return;
  tray=new Tray(appIcon());
  trayPresentation=new StatusTray({tray,createIcon:summary=>trayIcon(nativeImage,appIcon(),summary),createMenu:summary=>{
    const t=(key,...values)=>translated(summary.language,key,...values);
    return Menu.buildFromTemplate([{id:'tray-show',label:t('Show line'),click:()=>show('shelves')},{id:'tray-mini',label:t('Mini clipboard')||'Mini Pano (Alt+Shift+V)',click:()=>show('mini')},{id:'tray-library',label:t('Library'),click:()=>show('library')},{id:'tray-capture',label:t('Screenshots'),click:()=>capture()},{id:'tray-settings',label:t('Settings'),click:()=>show('settings')},
      ...(summary.updateVersion?[{id:'tray-update',label:t('Update available')+': v'+summary.updateVersion+'…',click:()=>{if(!UPDATES_SUPPORTED&&githubUpdates?.state?.releaseUrl)void shell.openExternal(githubUpdates.state.releaseUrl);else void openUpdates();}}]:[]),
      {id:'tray-check',label:t('Check for updates…'),click:async()=>{await openUpdates();if(UPDATES_SUPPORTED&&!development)await updates.check();else if(githubUpdates)await githubUpdates.check();}},
      {type:'separator'},{id:'tray-quit',label:t('Quit %@','ClipBoardLine'),click:()=>app.quit()}]);
  }});
  refreshTray();tray.on('click',()=>desiredVisible?hide():show('shelves'));
}

function updateAvailable(manifest){
  refreshTray();if(testMode||!Notification.isSupported())return;
  if(UPDATES_SUPPORTED&&!store.data.settings.autoCheckUpdates)return;
  const isTr=outputLanguage()==='tr';
  const notice=new Notification({
    title:isTr?`ClipBoardLine v${manifest.version} mevcut!`:`ClipBoardLine v${manifest.version} available!`,
    body:isTr?`GitHub'da yeni sürüm yayınlandı (v${manifest.version}). İncelemek için tıkla.`:`New release v${manifest.version} is available on GitHub. Click to view.`,
    silent:false,
  });
  notice.on('click',()=>{if(!UPDATES_SUPPORTED&&manifest.url)void shell.openExternal(manifest.url);else void openUpdates();});
  notice.show();
}
async function launchInstaller(file,args){const child=spawn(file,args,{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();}
function trusted(event) {
  if(!window || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entry) throw new Error('Untrusted application frame');
}
function rememberNormalBounds(){if(window&&view!=='shelves'&&view!=='capture'&&!applyingBounds&&!window.isMinimized()){normalBounds=window.getNormalBounds();normalMaximized=window.isMaximized();}}
function fitNormalBounds(area){const width=Math.min(area.width,normalBounds?.width||1180),height=Math.min(area.height,normalBounds?.height||800);return{width,height,x:Math.min(area.x+area.width-width,Math.max(area.x,normalBounds?.x??Math.round(area.x+(area.width-width)/2))),y:Math.min(area.y+area.height-height,Math.max(area.y,normalBounds?.y??Math.round(area.y+(area.height-height)/2)))};}
function fitCaptureBounds(area){const width=Math.min(area.width-48,Math.max(780,Math.round(area.width*0.76))),height=Math.min(area.height-48,Math.max(540,Math.round(area.height*0.76)));return{width,height,x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2)};}
let cachedLinuxOutputs=new Map(),lastLinuxOutputsFetch=0;
function getLinuxOutputs(){
  const now=Date.now();
  if(cachedLinuxOutputs.size>0&&now-lastLinuxOutputsFetch<5000)return cachedLinuxOutputs;
  try{
    const {execFileSync}=require('node:child_process');
    const stdout=execFileSync('kscreen-doctor',['-j'],{timeout:500,encoding:'utf8'});
    const data=JSON.parse(stdout);const map=new Map();
    for(const out of data.outputs||[]){
      if(out.enabled&&out.pos&&out.size){
        map.set(out.name,{x:out.pos.x,y:out.pos.y,width:out.size.width,height:out.size.height});
      }
    }
    if(map.size>0){cachedLinuxOutputs=map;lastLinuxOutputsFetch=now;}
    return cachedLinuxOutputs;
  }catch{return cachedLinuxOutputs;}
}

function getLinuxActiveOutputName(){
  if(process.platform!=='linux')return null;
  try{
    const {execFileSync}=require('node:child_process');
    const out=execFileSync('busctl',['--user','call','org.kde.KWin','/KWin','org.kde.KWin','activeOutputName'],{timeout:250,encoding:'utf8'}).trim();
    const match=out.match(/s\s+"([^"]+)"/);
    return match?match[1]:null;
  }catch{return null;}
}

function getCursorPosition(){
  if(typeof screen!=='undefined'&&screen.getCursorScreenPoint){
    try{
      const pt=screen.getCursorScreenPoint();
      if(pt&&(pt.x!==0||pt.y!==0))return pt;
    }catch{}
  }
  return null;
}

function getActiveDisplay(cursor=null){
  if(typeof screen!=='undefined'){
    const displays=screen.getAllDisplays();
    if(displays.length<=1)return displays[0]||screen.getPrimaryDisplay();
    if(process.platform==='linux'){
      const activeName=getLinuxActiveOutputName();
      if(activeName){
        const outputs=getLinuxOutputs(),target=outputs.get(activeName);
        if(target){
          const found=displays.find(d=>d.bounds.x===target.x&&d.bounds.y===target.y);
          if(found)return found;
          const bySize=displays.find(d=>d.bounds.width===target.width&&d.bounds.height===target.height);
          if(bySize)return bySize;
        }
      }
    }
    if(cursor&&Number.isFinite(cursor.x)&&Number.isFinite(cursor.y)){
      const found=displays.find(d=>cursor.x>=d.bounds.x&&cursor.x<d.bounds.x+d.bounds.width&&cursor.y>=d.bounds.y&&cursor.y<d.bounds.y+d.bounds.height);
      if(found)return found;
      return screen.getDisplayNearestPoint(cursor);
    }
  }
  return screen.getPrimaryDisplay();
}
function getCaptureDisplay(){
  if(typeof screen!=='undefined'){
    const displays=screen.getAllDisplays();
    if(displays.length<=1)return displays[0]||screen.getPrimaryDisplay();
    if(lastClickDisplayId!=null){
      const clicked=displays.find(d=>d.id===lastClickDisplayId);
      if(clicked)return clicked;
    }
    return getActiveDisplay(getCursorPosition());
  }
  return screen.getPrimaryDisplay();
}
async function show(next='shelves',event=null) {
  cancelRecordingTrims();
  if(pastePromise){pasteGeneration++;cancelNativePaste();}
  const generation=++visibilityGeneration,wasClosing=!desiredVisible&&window.isVisible(),previousView=view;desiredVisible=true;shelfMotion.cancel();showing++;
  try {
    // A hidden window can still be restoring its previous native field.
    // Complete that operation before a rapid reopen captures and takes focus.
    if(hidePromise)await hidePromise;
    if(generation!==visibilityGeneration)return;
    if(next!=='capture'&&next!=='library'&&next!=='settings'&&(!window.isVisible() || !window.isFocused())) {
      const observed=pasteTargets.reenter();
      if(observed){
        previous=observed;
      }else{
        void native.capture().then(target=>{if(generation===visibilityGeneration&&desiredVisible)previous=pasteTargets.capture(target);}).catch(()=>{});
      }
    }
    if(next!=='capture')pendingCapture=null;
    rememberNormalBounds();view=next;message='';
    const cursor=getCursorPosition();
    const requestedDisplay=event?.displayId!=null?screen.getAllDisplays().find(d=>d.id===event.displayId):null;
    const display=requestedDisplay||getActiveDisplay(cursor);
    const isOverlay=next==='shelves'||next==='mini';
    let mousePos=null;
    if(next==='mini'&&cursor&&Number.isFinite(cursor.x)&&Number.isFinite(cursor.y)){
      const originX=display.workArea?.x??display.bounds.x;
      const originY=display.workArea?.y??display.bounds.y;
      const areaW=display.workArea?.width??display.bounds.width;
      const areaH=display.workArea?.height??display.bounds.height;
      if(cursor.x>=originX&&cursor.x<originX+areaW&&cursor.y>=originY&&cursor.y<originY+areaH){
        const relX=Math.max(0,Math.min(cursor.x-originX,areaW-1));
        const relY=Math.max(0,Math.min(cursor.y-originY,areaH-1));
        mousePos={x:relX,y:relY,screenWidth:areaW,screenHeight:areaH};
      }
    }
    viewEvent=event?{...event,...(mousePos?{mousePosition:mousePos}:{}),serial:crypto.randomUUID()}:(mousePos?{mousePosition:mousePos,serial:crypto.randomUUID()}:null);
    applyingBounds=true;
    try{
      const isCapture=next==='capture';
      const isFullOverlay=isOverlay||isCapture;
      const surface=isOverlay?'overlay':isCapture?'capture':'normal';
      const bounds=isCapture?display.bounds:isOverlay?display.workArea:fitNormalBounds(display.workArea);
      const currentBounds=window.getBounds();
      const boundsChanged=!windowBounds.same(currentBounds,bounds);
      if(process.platform==='linux'&&!testMode&&window.isVisible()&&(!window.isFocused()||windowSurface!==surface||previousView!==next||boundsChanged))window.hide();
      if(windowSurface!==surface){window.setMinimumSize(isFullOverlay?1:640,isFullOverlay?1:360);window.setResizable(!isFullOverlay);window.setMaximizable(!isFullOverlay);window.setSkipTaskbar(isFullOverlay);window.setBackgroundColor(isOverlay?'#00000000':isCapture?'#000000':'#18191d');window.setHasShadow(!isFullOverlay);window.setAlwaysOnTop((process.platform==='linux'&&!testMode)||isFullOverlay,isCapture?'screen-saver':'normal');windowSurface=surface;}
      const unlockResize=boundsChanged&&isFullOverlay&&!window.isResizable();
      if(unlockResize)window.setResizable(true);
      windowBounds.apply(window,bounds,{overlay:isFullOverlay});
      if(unlockResize)window.setResizable(false);
      if(!isFullOverlay&&normalMaximized)window.maximize();
    }finally{applyingBounds=false;}
    const animate=next==='shelves'&&(!window.isVisible()||wasClosing||previousView==='capture');
    if(animate)await shelfMotion.request('prepare',{hidden:!window.isVisible()||previousView==='capture'});else await shelfMotion.request('reset');
    if(generation!==visibilityGeneration)return;
    const prePaintCapture=next==='capture'&&!window.isVisible();
    if(prePaintCapture){
      // Paint capture workspace & decoded screenshot before revealing window so shelves never flash.
      const readyPromise=waitForCaptureReady(pendingCapture?.id,350);
      broadcast({surfaceOnly:true});
      await readyPromise;
      if(generation!==visibilityGeneration)return;
    }
    try{window.setIgnoreMouseEvents(false);}catch{}
    if(prePaintCapture&&process.platform==='win32'){
      try{
        window.setOpacity(0);
        window.show();window.moveTop?.();window.focus();windowBounds.shown(window);broadcast({surfaceOnly:true});
        await new Promise(resolve=>setTimeout(resolve,32));
      }finally{
        if(window&&!window.isDestroyed())try{window.setOpacity(1);}catch{}
      }
    }else{
      window.show();window.moveTop?.();window.focus();windowBounds.shown(window);broadcast({surfaceOnly:true});
    }
    // Commands can await the settled pixels, but the window and keyboard are
    // available immediately. A concurrent toggle can cancel this animation.
    if(animate)await shelfMotion.request('open');
  }finally{showing--;}
}
async function hide(restore=true) {
  cancelRecordingTrims();
  if(restore&&pastePromise){pasteGeneration++;cancelNativePaste();}
  // A reopen can cancel an older close while its promise is still unwinding.
  // A subsequent close must supersede that reopen rather than reuse the
  // canceled operation and lose the user's newest toggle.
  if(hidePromise&&!desiredVisible)return hidePromise;
  const pendingHide=hidePromise;
  const generation=++visibilityGeneration;desiredVisible=false;shelfMotion.cancel();
  const operation=(async()=>{
    if(pendingHide)await pendingHide;
    if(generation!==visibilityGeneration)return;
    pendingCapture=null;const wasCapture=view==='capture';
    if(wasCapture&&window.isVisible())window.hide();
    if(wasCapture)view='shelves';
    rememberNormalBounds();const target=previous;viewEvent=null;broadcast({surfaceOnly:true});
    if(view==='shelves'&&!wasCapture&&window.isVisible())await shelfMotion.request('close');
    if(generation!==visibilityGeneration)return;
    previous=null;window.hide();
    if(restore&&target)await native.restore(target).catch(()=>{});
  })();
  hidePromise=operation;
  try{await operation;}finally{if(hidePromise===operation)hidePromise=null;}
}
async function clipboardContent() {
  return readClipboardContent({clipboard,sequence:()=>native.clipboardSequence(),marker:copyMarker,plainURL,captureLinks:store?.data.settings.captureLinks!==false});
}

function enqueueClipboard(event) {
  if(!store||closing||!['captureText','captureImages','captureLinks'].some(key=>store.data.settings[key]))return;
  clipboardQueue.push(event);
  void processClipboardQueue();
}

async function processClipboardQueue() {
  if(processingClipboard)return;
  processingClipboard=true;
  try{
    while(clipboardQueue.length>0){
      if(!store||closing||!['captureText','captureImages','captureLinks'].some(key=>store.data.settings[key])){
        clipboardQueue.length=0;break;
      }
      const rawEvent=clipboardQueue.shift();
      try{
        await handleClipboardEvent(rawEvent);
      }catch(error){
        console.error('[ClipBoardLine] capture error:', error);
      }
    }
  }finally{
    processingClipboard=false;
  }
}

async function handleClipboardEvent(rawEvent) {
  let content = null;

  if (rawEvent && typeof rawEvent === 'object' && Array.isArray(rawEvent.types)) {
    if (rawEvent.origin === 'clipboardline') return;
    if (privateClipboard(rawEvent.types)) return;

    let kind = null, value = null, html = null, fingerprint = rawEvent.fingerprint || null;

    if (rawEvent.image_path && (rawEvent.types.includes('image/png') || rawEvent.types.some(t => t.startsWith('image/')))) {
      if (!store.data.settings.captureImages) return;
      try {
        const buf = await fs.promises.readFile(rawEvent.image_path);
        if (buf && buf.length >= 24 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
          kind = 'image';
          value = buf;
          if (!fingerprint) {
            fingerprint = 'image:' + crypto.createHash('sha256').update(buf).digest('hex');
          }
        }
      } catch (err) {
        console.error('[ClipBoardLine] Failed to read daemon cached image:', err);
      }
    }

    if (!kind && rawEvent.text) {
      if (typeof rawEvent.text === 'string' && /\P{White_Space}/u.test(rawEvent.text)) {
        const bytes = Buffer.from(rawEvent.text, 'utf8');
        if (bytes.length <= 1024 * 1024) {
          // With link capture off a standalone URL is ordinary text (upstream f3f4f89).
          const url = store.data.settings.captureLinks !== false ? plainURL(rawEvent.text) : null;
          kind = url ? 'link' : 'text';
          value = url || rawEvent.text;
          if (rawEvent.html && typeof rawEvent.html === 'string' && rawEvent.html.length <= 2 * 1024 * 1024) {
            html = rawEvent.html;
          }
          if (!fingerprint) {
            fingerprint = kind + ':' + crypto.createHash('sha256').update(bytes).digest('hex');
          }
        }
      }
    }

    if (kind && value && fingerprint) {
      content = { kind, value, html, owned: false, fingerprint };
    }
  }

  if (!content) {
    content = await clipboardContent();
  }

  if (!content || content.raced || content.owned) return;

  if (content.fingerprint === lastFingerprint) return;
  lastFingerprint = content.fingerprint;
  if (content.fingerprint === ownFingerprint) {
    ownFingerprint = '';
    return;
  }

  const key = { image: 'captureImages', text: 'captureText', link: 'captureLinks' }[content.kind];
  if (!store.data.settings[key]) return;

  if (content.kind === 'image') {
    if (!Buffer.isBuffer(content.value) || content.value.length < 24 || content.value.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      return;
    }
  }

  console.log('[ClipBoardLine] Captured new clipboard item:', content.kind, content.kind === 'image' ? (content.value?.length + ' bytes') : (content.value?.slice ? content.value.slice(0, 80) : ''));
  const item = store.insert(content.kind, content.value, { html: content.html });
  broadcast();
  if (item.kind === 'link') void enrich(item.id);
  if (item.kind === 'image') {
    queueOCR(item.id);
    refreshImageSearch();
  }
}

const readClipboard = (event) => enqueueClipboard(event);
async function enrich(id,{refresh=false}={}) {
  if(!store.data.settings.fetchLinkMetadata||(!refresh&&pending.has(id)))return;
  const generation=Symbol(id);pending.set(id,generation);
  const current=()=>pending.get(id)===generation&&store.data.settings.fetchLinkMetadata;
  try {
    const item=store.item(id),url=item.url;if(item.kind!=='link')return;
    if(refresh){delete item.thumbnailFile;delete item.author;item.title=new URL(url).hostname;store.persist();broadcast();}
    const metadata=await linkMetadata(url);
    if(!current()||!store.data.items.includes(item)||item.trashedAt||item.url!==url)return;
    let thumbnail=null;
    if(metadata.thumbnail){try{const response=await thumbnailFetch(metadata.thumbnail);const image=nativeImage.createFromBuffer(response.bytes);if(!image.isEmpty()){const size=image.getSize();if(size.width*size.height<=16_000_000)thumbnail=image.resize({width:Math.min(size.width,640)}).toPNG();}}catch{}}
    if(!current()||!store.data.items.includes(item)||item.trashedAt||item.url!==url)return;
    if(store.setLinkMetadata(item,url,{title:metadata.title,author:metadata.author,thumbnail}))broadcast();
  }catch(error){if(refresh&&current())throw new Error('Link preview could not be refreshed: '+error.message);}
  finally{if(pending.get(id)===generation)pending.delete(id);}
}
async function writeClipboard(selected) {
  if(!selected.length)throw new Error('Select an item first');
  const images=selected.filter(item=>item.kind==='image');
  const values=selected.filter(item=>item.kind!=='image').map(item=>item.kind==='link'?item.url:item.text);
  if(images.some(item=>item.recording)){
    await copyFiles({files:images.map(item=>store.mediaPath(item.id)),marker:copyMarker.toString('base64'),text:values.join('\n\n')});
    ownFingerprint=(await clipboardContent())?.fingerprint||'';lastFingerprint=ownFingerprint;store.markCopied(selected.filter(item=>store.data.items.includes(item)).map(item=>item.id));return;
  }
  if(images.length>1){
    await native.copyImages({files:images.map(item=>store.mediaPath(item.id)),marker:copyMarker.toString('base64'),text:values.join('\n\n')});
    ownFingerprint=(await clipboardContent())?.fingerprint||'';lastFingerprint=ownFingerprint;store.markCopied(selected.filter(item=>store.data.items.includes(item)).map(item=>item.id));return;
  }
  const data={};
  if(values.length)data['text/plain']=new Blob([values.join('\n\n')],{type:'text/plain'});
  if(selected.length===1&&selected[0].html){
    data['text/html']=new Blob([selected[0].html],{type:'text/html'});
  }
  if(images.length){const image=nativeImage.createFromPath(store.mediaPath(images[0].id));if(image.isEmpty())throw new Error('Image unavailable');await writeImageClipboard(image.toPNG(),data);}
  else await writeMarkedClipboard(data);
  store.markCopied(selected.filter(item=>store.data.items.includes(item)).map(item=>item.id));
}
// Every clipboard write carries copyMarker and records its fingerprint, so the
// daemon's echo of our own write is recognised and never imported again.
async function writeMarkedClipboard(flavours){
  const data={'web application/x.clipboardline':new Blob([copyMarker])};
  data['application/x-orkun-origin'] = new Blob([JSON.stringify({app: 'clipboardline'})], {type: 'application/x-orkun-origin'});
  Object.assign(data,flavours);
  await clipboard.write([new ClipboardItem(data)]);
  ownFingerprint=(await clipboardContent())?.fingerprint||'';lastFingerprint=ownFingerprint;
}
// A PNG that need not be a Library item yet (capture commit copies before storing).
async function writeImageClipboard(png,flavours={}){await writeMarkedClipboard({...flavours,'image/png':new Blob([png],{type:'image/png'})});}
async function copy(payload,paste=false) {
  if(pastePromise)return pastePromise;
  const selected=store.selected(ids(payload.ids));
  if(!selected.length)throw new Error('Select an item first');
  const target=paste?pasteTargets.resolve(previous):previous;
  if(paste)previous=target;
  if(paste&&(!target||!target.editable||target.secure))throw new Error('Select an editable field in another application, then reopen the shelves.');
  if(paste){
    const generation=++pasteGeneration;
    const current=()=>{if(generation!==pasteGeneration)throw new Error('Paste canceled by another browsing action.');};
    const operation=(async()=>{try{
      await native.preparePaste(target);current();await hide(false);current();
      // The helper may have restored the field before hiding our source UI.
      // Validate the exact destination again after dismissal and before any
      // clipboard mutation, just as the native Mac coordinator does.
      await native.validatePaste(target);current();await writeClipboard(selected);current();
      await native.paste({...target,prepared:true});current();if(store.data.settings.sounds)shell.beep();
    }catch(error){if(generation===pasteGeneration)await show(view);throw error;}})();
    pastePromise=operation;try{return await operation;}finally{if(pastePromise===operation)pastePromise=null;}
  }
  await writeClipboard(selected);
  if(store.data.settings.sounds)shell.beep();
  if(payload.keepOpen&&!paste){if(selected.length<=1)notify('Copied');return;}
  await hide();
}
async function importFile(file) {
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Select a regular file.');
  const extension=path.extname(file).toLowerCase();
  if(['.mov','.mp4'].includes(extension)){
    if(stat.size>MAXIMUM_VIDEO_BYTES)throw new Error('Recording exceeds the 2 GB import limit.');
    const inspected=await mediaJobs.probe(file);
    try{
      const after=fs.lstatSync(file);if(after.isSymbolicLink()||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw new Error('The recording changed while importing.');
      const item=await store.insertRecording(inspected);refreshImageSearch();return item;
    }finally{mediaJobs.release(inspected);}
  }
  if(stat.size>64*1024*1024)throw new Error('File exceeds import limit');
  if(['.txt','.md'].includes(extension)) {if(stat.size>1024*1024)throw new Error('Text file exceeds import limit');const value=decodeTextFile(fs.readFileSync(file));return store.insert(plainURL(value)?'link':'text',value);}
  const image=nativeImage.createFromPath(file);if(image.isEmpty())throw new Error('Unsupported image file');const item=store.insert('image',image.toPNG());queueOCR(item.id);refreshImageSearch();return item;
}
async function capture() {
  const wasVisible=window.isVisible();
  visibilityGeneration++;desiredVisible=false;shelfMotion.cancel();viewEvent=null;
  if(wasVisible){
    window.hide();
    broadcast({surfaceOnly:true});
    await shelfMotion.request('reset');
    // Wait briefly only when our own window actually had to leave the compositor.
    await new Promise(resolve=>setTimeout(resolve,60));
  }
  try{
    let capturedImage = null;
    let pngBuffer = null;
    const activeDisplay = getCaptureDisplay();
    if(process.platform === 'win32') {
      const tempRaw = path.join(require('node:os').tmpdir(), 'clipboardline-shot-' + Date.now() + '-' + process.pid + '.bgra');
      try {
        const physRect = typeof screen.dipToScreenRect === 'function'
          ? screen.dipToScreenRect(null, activeDisplay.bounds)
          : {
              x: Math.round(activeDisplay.bounds.x * activeDisplay.scaleFactor),
              y: Math.round(activeDisplay.bounds.y * activeDisplay.scaleFactor),
              width: Math.round(activeDisplay.bounds.width * activeDisplay.scaleFactor),
              height: Math.round(activeDisplay.bounds.height * activeDisplay.scaleFactor)
            };
        const res = await native.captureScreen(physRect, tempRaw);
        if (res && res.ok && fs.existsSync(tempRaw)) {
          const rawBuf = await fs.promises.readFile(tempRaw);
          try { await fs.promises.unlink(tempRaw); } catch {}
          if (rawBuf.length === res.width * res.height * 4) {
            const img = nativeImage.createFromBitmap(rawBuf, { width: res.width, height: res.height });
            if (!img.isEmpty()) capturedImage = img;
          }
        }
      } catch {} finally {
        try { if (fs.existsSync(tempRaw)) await fs.promises.unlink(tempRaw); } catch {}
      }
    } else if(process.platform === 'linux') {
      const tempShot = path.join(require('node:os').tmpdir(), 'clipboardline-shot-' + Date.now() + '.png');
      try {
        if (fs.existsSync('/usr/bin/spectacle')) {
          await new Promise((resolve) => {
            execFile('/usr/bin/spectacle', ['-m', '-b', '-n', '-o', tempShot], { timeout: 5000 }, resolve);
          });
        } else if (fs.existsSync('/usr/bin/grim')) {
          const g = `${activeDisplay.bounds.x},${activeDisplay.bounds.y} ${activeDisplay.bounds.width}x${activeDisplay.bounds.height}`;
          await new Promise((resolve) => {
            execFile('/usr/bin/grim', ['-g', g, tempShot], { timeout: 5000 }, resolve);
          });
        }
        if (fs.existsSync(tempShot)) {
          pngBuffer = await fs.promises.readFile(tempShot);
          try { await fs.promises.unlink(tempShot); } catch {}
          capturedImage = nativeImage.createFromBuffer(pngBuffer);
        }
      } catch {}
    }

    if(!capturedImage || capturedImage.isEmpty()) {
      try {
        const display=activeDisplay;
        const displays=screen.getAllDisplays();
        const displayIndex=displays.findIndex(d=>d.id===display.id);
        const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
        const source=
          sources.find(s=>s.display_id&&s.display_id===String(display.id))||
          (displayIndex>=0?sources.find(s=>s.id==='screen:'+displayIndex+':0'):null)||
          (displayIndex>=0?sources[displayIndex]:null)||
          sources[0];
        if(source && !source.thumbnail.isEmpty()) {
          capturedImage = source.thumbnail;
        }
      } catch {}
    }

    if(!capturedImage || capturedImage.isEmpty()) throw new Error('Screen capture is unavailable');
    if(testMode){
      const buf=pngBuffer||capturedImage.toPNG();
      const item=store.insert('image',buf);queueOCR(item.id);refreshImageSearch();await show('shelves',{selectId:item.id,kind:'image',preview:true,crop:true});return{id:item.id};
    }
    const size=capturedImage.getSize();
    const id=crypto.randomUUID();
    const previewJpeg=capturedImage.toJPEG(92);
    pendingCapture={id,image:capturedImage,buffer:pngBuffer,previewJpeg,dataUrl:'appmedia://media/pending/'+id,width:size.width,height:size.height,displayId:activeDisplay.id,createdAt:Date.now()};
    await show('capture',{captureId:id,displayId:activeDisplay.id});
    return{captureId:id};
  }catch(error){if(wasVisible)await show(view);throw error;}
}
function openGoogleLensInBrowser(imageObj, lang='tr') {
  const http = require('node:http');
  const size = imageObj.getSize();
  const scale = Math.min(1, 1600 / Math.max(size.width || 1, size.height || 1));
  const resized = scale < 1
    ? imageObj.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' })
    : imageObj;
  const finalSize = resized.getSize();
  const jpegB64 = resized.toJPEG(88).toString('base64');
  const hl = lang === 'tr' ? 'tr' : 'en';
  const actionUrl = `https://lens.google.com/v3/upload?hl=${hl}&stcs=${Date.now()}&ep=ccm&re=df`;
  const dims = `${finalSize.width},${finalSize.height}`;
  const label = lang === 'tr' ? "Google Lens'e gönderiliyor…" : 'Sending image to Google Lens…';
  const html = `<!doctype html><html lang="${hl}"><head><meta charset="utf-8"><title>Google Lens — ClipBoardLine</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#16171d;color:#e6e8f0;font:500 15px/1.5 system-ui,-apple-system,sans-serif}.card{display:flex;align-items:center;gap:12px;padding:14px 20px;border-radius:12px;background:#21232d;border:1px solid rgba(255,255,255,.08);box-shadow:0 12px 32px rgba(0,0,0,.35)}.spin{width:18px;height:18px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#7c9cff;border-radius:50%;animation:s .7s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="card"><div class="spin"></div><span>${label}</span></div>
<form id="f" method="POST" action="${actionUrl}" enctype="multipart/form-data" style="display:none">
<input type="file" name="encoded_image" id="fi">
<input type="hidden" name="processed_image_dimensions" value="${dims}">
</form>
<script>
try {
  const b64 = ${JSON.stringify(jpegB64)};
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], 'capture.jpg', { type: 'image/jpeg' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById('fi').files = dt.files;
  document.getElementById('f').submit();
} catch (e) {
  location.replace('https://lens.google.com/?hl=${hl}');
}
</script></body></html>`;
  const token = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === `/lens/${token}`) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        setTimeout(() => { try { server.close(); } catch {} }, 1500).unref?.();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const guard = setTimeout(() => { try { server.close(); } catch {} }, 25000);
    guard.unref?.();
    server.on('close', () => clearTimeout(guard));
    server.on('error', err => {
      clearTimeout(guard);
      if (!settled) { settled = true; reject(err); }
    });
    server.listen(0, '127.0.0.1', () => {
      if (settled) return;
      settled = true;
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}/lens/${token}`);
    });
  });
}
const INDEX_LANGUAGES=['eng','tur'];
async function ocr(id,quiet=false,languages=INDEX_LANGUAGES){const key=id+':'+languages.join('+');if(ocrJobs.has(key))return ocrJobs.get(key);const promise=recognize(id,quiet,languages);ocrJobs.set(key,promise);try{return await promise;}finally{ocrJobs.delete(key);}}
// Bundled tessdata: packaged resources/ocr-data, or node_modules/@tesseract.js-data in a source checkout.
const bundledOcrDirectory=()=>app.isPackaged?path.join(process.resourcesPath,'ocr-data'):path.join(__dirname,'node_modules','@tesseract.js-data');
async function recognize(id,quiet=false,languages=INDEX_LANGUAGES) {
  const item=store.item(id);if(item.kind!=='image'||item.recording)throw new Error('OCR requires a still image');
  const file=store.mediaPath(id);const fingerprint=item.renderedFile||item.imageFile;
  // Only the background index languages (eng+tur) read and fill the item.ocrText cache.
  const cacheable=languages.join('+')===INDEX_LANGUAGES.join('+');
  if(cacheable&&item.ocrText)return{text:item.ocrText,id};
  if(!quiet)notify('Recognizing image text locally…');
  const {createWorker}=require('tesseract.js');
  const languageDirectory=path.join(store.directory,'ocr-models');
  await prepareOcrLanguages({languages,directory:languageDirectory,available:()=>output.installedLanguages()});
  // Upstream: never let tesseract.js write or reuse a decompressed .traineddata cache next to the
  // verified .gz models; remove one left by an older build (async, off the hot path).
  await Promise.all(languages.map(language=>fs.promises.rm(path.join(languageDirectory,language+'.traineddata'),{force:true}).catch(err=>console.warn('Could not remove stale OCR cache:',err?.message||err))));
  const worker=await createWorker(languages,1,{langPath:languageDirectory,cachePath:languageDirectory,cacheMethod:'none',gzip:true});
  try{let image=nativeImage.createFromPath(file);const size=image.getSize(),scale=Math.min(1,2400/Math.max(size.width,size.height));if(scale<1)image=image.resize({width:Math.round(size.width*scale),height:Math.round(size.height*scale)});const result=await worker.recognize(image.toPNG());if(!store.data.items.includes(item)||(item.renderedFile||item.imageFile)!==fingerprint)throw new Error(outputText(outputLanguage(),'imageChanged'));const text=String(result.data.text||'').slice(0,1024*1024);if(!cacheable)return{text,id};item.ocrText=text;store.persist();if(!quiet)notify(item.ocrText?'Image text ready':'No text found');else broadcast();return{text:item.ocrText,id};}
  finally{await worker.terminate();}
}
function configureWatchers() {
  for(const watcher of watchers)watcher.close();watchers=[];
  const home=require('node:os').homedir();
  const defaultDirs=process.platform==='linux'
    ?[path.join(home,'Pictures','Screenshots'),path.join(home,'Resimler','Ekran Görüntüleri'),path.join(home,'Resimler','Screenshots')]
    :(process.platform==='win32'?[path.join(home,'Pictures','Screenshots'),path.join(home,'OneDrive','Pictures','Screenshots'),path.join(home,'OneDrive','Resimler','Ekran Görüntüleri')]:[]);
  const folders=[...new Set([...store.data.settings.watchFolders,...defaultDirs.filter(d=>{try{return fs.statSync(d).isDirectory();}catch{return false;}})])];
  for(const folder of folders){try{if(!fs.statSync(folder).isDirectory())continue;const timers=new Map();const watcher=fs.watch(folder,(_event,name)=>{if(!name||!/[.](png|jpe?g|webp|bmp|mov|mp4)$/i.test(name)||name.startsWith('.'))return;clearTimeout(timers.get(name));timers.set(name,setTimeout(()=>{timers.delete(name);try{const file=path.join(folder,path.basename(name));if(output?.ownsFile(file))return;const item=importFile(file);Promise.resolve(item).then(record=>{broadcast();if(store.data.settings.openAfterScreenshot)void show('shelves',{selectId:record.id,kind:'image',freshlyCaptured:true});}).catch(err=>{console.warn('Watch folder import error:',err?.message||err);});}catch(err){console.warn('Watch folder item error:',err?.message||err);}},700));});watcher.on('error',err=>{console.warn('Watch folder watcher error:',err?.message||err);});watchers.push(watcher);}catch(err){console.warn('Watch folder configure error:',err?.message||err);}}
}
// English catalog titles (the Settings rows) so the renderer can localize a failed-restore notice.
const SHORTCUT_TITLES={toggle:'Show or hide the line',search:'Search shelves from other apps',library:'Open library',copyLatest:'Copy latest image',screenshot:'Screenshot',mini:'Open mini clipboard'};
let shortcutRegistry,shortcutRecording=null;
function finishShortcutRecording(token=null){
  if(!shortcutRecording||(token!==null&&shortcutRecording.token!==token))return;
  const current=shortcutRecording;shortcutRecording=null;current.resume();
}
function startShortcutRecording(token){
  if(typeof token!=='string'||!/^[A-Za-z0-9:-]{1,100}$/.test(token))throw new Error('Invalid shortcut recorder.');
  if(shortcutRecording?.token===token)return;
  if(!window?.isVisible()||!window.isFocused())throw new Error('Focus the shortcut recorder before recording.');
  if(!shortcutRegistry)configureShortcuts();
  const resume=shortcutRegistry.suspend(),previous=shortcutRecording;shortcutRecording={token,resume};previous?.resume();
}

function configureShortcuts(previousPreferences=null) {
  if(process.platform==='linux'&&!testMode&&!previousPreferences){
    const sc=store.data.settings.shortcuts||{};
    if(!sc.library||sc.library==='Alt+I'){try{store.modify('setSettings',{patch:{shortcuts:{library:'Alt+Shift+L'}}});}catch{}}
    if(!sc.mini||sc.mini==='Alt+Super+V'){try{store.modify('setSettings',{patch:{shortcuts:{mini:'Meta+V'}}});}catch{}}
  }
  shortcutRegistry??=new GlobalShortcuts(createLinuxShortcutRegistry(globalShortcut),{
    toggle:()=>(desiredVisible&&window?.isVisible()&&(testMode||window?.isFocused())&&view==='shelves')?hide():show('shelves'),
    search:()=>show('shelves',{search:true}),
    library:()=>(desiredVisible&&window?.isVisible()&&window?.isFocused()&&view==='library')?hide():show('library'),
    copyLatest:async()=>{const latest=store.data.items.filter(item=>!item.trashedAt&&!item.hiddenFromShelf).sort((a,b)=>b.createdAt-a.createdAt)[0];if(latest){await writeClipboard([latest]);notify('Copied');if(store.data.settings.sounds)shell.beep();}},
    screenshot:capture,
    mini:()=>(desiredVisible&&window?.isVisible()&&(testMode||window?.isFocused())&&view==='mini')?hide():show('mini')
  },{failed:error=>notify(error.message)});
  const rejected=shortcutRegistry.update(store.data.settings.shortcuts);
  if(rejected.length){
    if(previousPreferences)store.modify('setSettings',{patch:{shortcuts:Object.fromEntries(rejected.map(value=>[value.action,previousPreferences[value.action]||'']))}});
    const unrestored=rejected.filter(value=>value.restorationFailed).map(value=>value.action);
    message='Shortcut '+rejected.map(value=>value.shortcut).join(', ')+' is unavailable. '+(unrestored.length?'Could not restore: '+unrestored.map(action=>SHORTCUT_TITLES[action]||action).join(', ')+'.':rejected.some(value=>value.previous)?'Working previous shortcuts are kept.':'Choose another combination in Settings.');
  }
  return rejected;
}

const modelActions=new Set(['pin','name','details','retain','note','unassign','removeTag','renameTag','deleteTag','folder','createFolder','renameFolder','removeFolder','tag','remove','undo','trash','trashUndoably','undoTrash','restore','delete','editText','saveImage','cleanup','clearUnsavedHistory']);
async function command(action,payload={}) {
  if(typeof action!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>92_000_000)throw new Error('Invalid command');
  message='';let result;
  if(action==='beginShortcutRecording')startShortcutRecording(payload.token);
  else if(action==='endShortcutRecording'){if(typeof payload.token==='string')finishShortcutRecording(payload.token);}
  else if(modelActions.has(action)){if(action==='saveImage'){if(typeof payload.dataUrl!=='string'||payload.dataUrl.length>90_000_000)throw new Error('Invalid edited image');const decoded=nativeImage.createFromDataURL(payload.dataUrl);if(decoded.isEmpty()||decoded.getSize().width*decoded.getSize().height>80_000_000)throw new Error('Invalid edited image');}result=store.modify(action,payload);if(action==='saveImage')queueOCR(payload.id);if(['saveImage','remove','delete','trash','trashUndoably','undoTrash','restore','undo','cleanup','clearUnsavedHistory'].includes(action))refreshImageSearch();if(action==='remove'||action==='trash'||action==='trashUndoably'||action==='delete'||action==='clearUnsavedHistory')viewEvent={removedIds:['clearUnsavedHistory','trash','trashUndoably'].includes(action)?result.ids:payload.ids||[payload.id],serial:crypto.randomUUID()};}
  else if(action==='show'||action==='search'||action==='mini')await show(action==='mini'?'mini':'shelves',action==='search'?{search:true}:null);
  else if(action==='hide'){if(pastePromise){pasteGeneration++;cancelNativePaste();}await hide();}
  else if(action==='library'||action==='settings')await show(action);
  else if(action==='windowClose'){if(pastePromise){pasteGeneration++;cancelNativePaste();}await hide();}
  else if(action==='windowMinimize'){if(view!=='shelves'){rememberNormalBounds();window.minimize();}}
  else if(action==='windowMaximize'){if(view!=='shelves'){if(window.isMaximized())window.unmaximize();else window.maximize();rememberNormalBounds();}}
  else if(action==='copy'||action==='paste')await copy(payload,action==='paste');
  else if(action==='cancelTrim'){recordingTrims.get(payload.id)?.abort();result={canceled:true};}
  else if(action==='trimRecording'){
    const item=store.item(payload.id);
    if(!item.recording||item.trashedAt||recordingTrims.has(item.id))throw new Error('Select an available recording.');
    const fingerprint=(item.renderedVideoFile||item.videoFile).slice(0,64);
    if(payload.sourceFingerprint!==fingerprint)throw new Error('The recording changed. Reopen its preview before trimming.');
    if(!Number.isFinite(payload.startMs)||!Number.isFinite(payload.endMs)||payload.startMs<0||payload.endMs>item.durationMs||payload.endMs-payload.startMs<50)throw new Error('Choose a nonempty interval within this recording.');
    const controller=new AbortController();recordingTrims.set(item.id,controller);let trimmed;
    try{
      trimmed=await mediaJobs.trim(store.mediaPath(item.id),{startMs:payload.startMs,endMs:payload.endMs,signal:controller.signal});
      if(controller.signal.aborted)throw new Error('Video operation canceled.');
      await store.commitRecordingTrim({id:item.id,sourceFingerprint:fingerprint,...trimmed,signal:controller.signal});
      result={id:item.id};refreshImageSearch();
    }finally{recordingTrims.delete(item.id);if(trimmed)mediaJobs.release(trimmed);}
  }
  else if(action==='openLink'){const item=store.item(payload.id);const url=plainURL(item.url);if(item.kind!=='link'||!url)throw new Error('Link unavailable');await shell.openExternal(url);}
  else if(action==='openFile'||action==='revealFile'){
    const item=store.item(payload.id);if(item.kind!=='image')throw new Error('Select an image first.');
    const file=store.mediaPath(item.id);if(action==='revealFile')shell.showItemInFolder(await output.savedFile(item.id)||file);else {const failure=await shell.openPath(file);if(failure)throw new Error(outputText(outputLanguage(),'imageOpenFailed'));}
  }
  else if(action==='refreshLink'){
    const item=store.item(payload.id);if(item.kind!=='link')throw new Error('Select a link first.');
    if(!store.data.settings.fetchLinkMetadata)throw new Error('Enable link metadata in Sources before refreshing link previews.');
    // Invalidate the in-flight job by identity; its completion must not replace
    // the new request's title or thumbnail after the user explicitly refreshes.
    await enrich(item.id,{refresh:true});result={id:item.id};
  }
  else if(action==='capture')result=await capture();
  else if(action==='commitCapture'){
    let finalBuffer=null;const captureRef=pendingCapture;
    const screenshot=captureRef?.buffer||(captureRef?.image?captureRef.image.toPNG():null);
    if(typeof payload.dataUrl==='string'&&payload.dataUrl.startsWith('data:image/png;base64,')){
      if(payload.dataUrl.length>90_000_000)throw new Error('Invalid captured image');
      const decoded=nativeImage.createFromDataURL(payload.dataUrl);
      if(decoded.isEmpty()||decoded.getSize().width*decoded.getSize().height>80_000_000)throw new Error('Invalid captured image');
      finalBuffer=decoded.toPNG();
    }else if(screenshot){
      finalBuffer=screenshot;
    }else throw new Error('No active screen capture.');
    pendingCapture=null;
    // copy:false = an output action (Save, Print, …) runs on the stored item next; no clipboard, beep or copied mark.
    const copyToClipboard=payload.copy!==false;
    // User-visible part first: the rendered PNG on the clipboard (marked as our
    // own write, so its echo is not imported) and the window hidden.
    if(copyToClipboard){
      await writeImageClipboard(finalBuffer).catch(()=>{});
      if(store.data.settings.sounds)shell.beep();
    }
    // Kaydedince ClipBoardLine öne gelmesin: gizle ve odağı önceki uygulamaya ver
    await hide();
    // Then the Library item: annotated captures are editable documents (always new).
    let item=null;
    try{
      const annotations=Array.isArray(payload.annotations)&&payload.annotations.length?payload.annotations:null;
      if(annotations){
        // The clean original is cut here, after the clipboard write and hide, from the same
        // screenshot the overlay showed; the renderer only sends its crop rect.
        if(!screenshot)throw new Error('No active screen capture.');
        const source=nativeImage.createFromBuffer(screenshot),size=source.getSize(),rect=payload.originalRect;
        const valid=rect&&['x','y','width','height'].every(key=>Number.isInteger(rect[key]))&&rect.x>=0&&rect.y>=0&&rect.width>=1&&rect.height>=1&&rect.x+rect.width<=size.width&&rect.y+rect.height<=size.height;
        if(source.isEmpty()||!valid)throw new Error('Invalid original image');
        const whole=rect.x===0&&rect.y===0&&rect.width===size.width&&rect.height===size.height;
        item=store.insertAnnotatedImage(whole?screenshot:source.crop(rect).toPNG(),finalBuffer,annotations);
      }else item=store.insert('image',finalBuffer);
      if(copyToClipboard)store.markCopied([item.id]);
      queueOCR(item.id);refreshImageSearch();
    }catch(error){announce(outputText(outputLanguage(),copyToClipboard?'libraryFailedCopied':'libraryFailed',describeError(outputLanguage(),error)));}
    result={id:item?.id??null};
  }
  else if(action==='googleLens'){
    let imgObj=null;
    if(typeof payload.dataUrl==='string'&&payload.dataUrl.startsWith('data:image/png;base64,')){
      if(payload.dataUrl.length>90_000_000)throw new Error('Invalid image');
      imgObj=nativeImage.createFromDataURL(payload.dataUrl);
      if(imgObj.isEmpty())throw new Error('Invalid image');
    }else if(payload.id){
      const item=store.item(payload.id);
      if(item.kind!=='image')throw new Error('Select an image first.');
      imgObj=nativeImage.createFromPath(store.posterPath(item.id));
      if(imgObj.isEmpty())throw new Error('Image unavailable');
    }else if(pendingCapture?.image){
      imgObj=pendingCapture.image;
    }else if(pendingCapture?.buffer){
      imgObj=nativeImage.createFromBuffer(pendingCapture.buffer);
    }else throw new Error('Select an image first.');
    pendingCapture=null;
    await hide(false);
    const pngBuffer=imgObj.toPNG();
    void writeImageClipboard(pngBuffer).catch(()=>{});
    const isTr=outputLanguage()==='tr';
    try{
      const bridgeUrl=await openGoogleLensInBrowser(imgObj,isTr?'tr':'en');
      await shell.openExternal(bridgeUrl);
      result={opened:true,direct:true};
    }catch{
      await shell.openExternal('https://lens.google.com/');
      announce(isTr?'Görsel panoya kopyalandı — Google Lens sayfasında Ctrl+V ile aratabilirsin.':'Image copied — press Ctrl+V on Google Lens to search.');
      result={opened:true,direct:false};
    }
  }
  else if(action==='openUpdateRelease'){
    const url=githubUpdates?.state?.releaseUrl||'https://github.com/cdokuro/clipboardline/tree/feat/linux-support';
    await shell.openExternal(url);
    result={opened:true};
  }
  else if(action==='cancelCapture'){
    pendingCapture=null;
    await hide();
    result={canceled:true};
  }
  else if(action==='newNote'){result={id:store.createNote(payload).id};}
  else if(action==='import'){const response=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],filters:[{name:'Images, recordings and text',extensions:['png','jpg','jpeg','webp','bmp','mov','mp4','txt','md']}]});const imported=[],failures=[];for(const file of response.filePaths){try{const item=await importFile(file);imported.push(item.id);if(item.kind==='link')void enrich(item.id);}catch(error){failures.push(path.basename(file)+': '+error.message);}}result={ids:imported,failed:failures.length};if(failures.length)message=`Imported ${imported.length} · failed ${failures.length}. ${failures[0]}`;}
  else if(action==='searchImages'){if(!imageSearch)throw new Error('Offline image search is unavailable.');result=await imageSearch.search(payload.query,payload.eligibleIds);}
  else if(action==='ocr')result=await ocr(payload.id);
  // Failures are announced inside handle (notification while hidden, toast while visible).
  else if(OUTPUT_COMMANDS.has(action))result=await output.handle(action,payload);
  else if(action==='copyOCR'){const recognized=await ocr(payload.id);if(!recognized.text.trim())throw new Error('No text found in this image.');await writeClipboard([{kind:'text',text:recognized.text}]);result=recognized;notify('Recognized text copied');}
  else if(action==='export'){
    const selected=store.selected(ids(payload.ids));if(!selected.length)throw new Error('Select an item first');
    const response=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']});if(response.filePaths[0]){
      const exported=await exportCopies(selected,response.filePaths[0],{mediaPath:id=>store.mediaPath(id)});
      result={count:exported.count,failed:exported.failed};message=exported.message;
    }
  }
  else if(action==='startDrag'){
    const selected=store.selected(ids(payload.ids));if(!selected.length||selected.length>1000)throw new Error('Select up to 1000 items to drag.');
    dragFiles??=new DragFiles(store.directory);const batch=dragFiles.prepare(selected,id=>store.mediaPath(id));
    let icon;try{
      const image=selected.find(item=>item.kind==='image');
      if(image){
        const raw=nativeImage.createFromPath(store.posterPath(image.id));
        const sz=raw.getSize(),maxD=64,scale=Math.min(1,maxD/Math.max(sz.width||1,sz.height||1));
        icon=raw.resize({width:Math.max(16,Math.round((sz.width||maxD)*scale)),height:Math.max(16,Math.round((sz.height||maxD)*scale))});
      }else{
        icon=appIcon().resize({width:48,height:48});
      }
      if(!icon||icon.isEmpty())icon=appIcon().resize({width:48,height:48});
    }catch{
      try{icon=appIcon().resize({width:48,height:48});}catch{}
    }
    try{
      if(window&&view==='shelves'){
        try{window.setIgnoreMouseEvents(true);}catch{}
      }
      window.webContents.startDrag({files:batch.files,icon});
    }catch(error){
      if(batch.batch)dragFiles.remove(batch.batch);
      throw error;
    }finally{
      if(window&&!window.isDestroyed()){
        try{window.setIgnoreMouseEvents(false);}catch{}
      }
    }
  }
  else if(action==='dragStartOverlay'){
    if(window&&view==='shelves'){
      try{window.setIgnoreMouseEvents(true);}catch{}
    }
    result=true;
  }
  else if(action==='dragEndOverlay'){
    if(window&&!window.isDestroyed()){
      try{window.setIgnoreMouseEvents(false);}catch{}
    }
    if(payload.completed&&view==='shelves')void hide(false);
    result=true;
  }
  else if(action==='setSettings'){
    if(payload.recordingToken!==undefined){if(typeof payload.recordingToken!=='string')throw new Error('Invalid shortcut recorder.');finishShortcutRecording(payload.recordingToken);}
    const patch={...payload.patch};
    if(Object.hasOwn(patch,'watchFolders'))throw new Error('Choose watched folders with the folder picker.');
    const wasIndexingImages=!!store.data.settings.indexImages;
    const previousShortcuts={...store.data.settings.shortcuts};
    store.modify('setSettings',{patch});if(wasIndexingImages&&!store.data.settings.indexImages)ocrQueue.discardPending();if(Object.hasOwn(patch,'retentionDays'))refreshImageSearch();if(Object.hasOwn(patch,'shortcuts')&&configureShortcuts(previousShortcuts).length)result={error:message};
    if(['captureText','captureImages','captureLinks'].some(key=>Object.hasOwn(patch,key)))lastFingerprint='';
    if(Object.hasOwn(patch,'launchAtLogin')&&!testMode){
      if(!app.isPackaged&&process.platform==='win32')app.setLoginItemSettings({openAtLogin:patch.launchAtLogin,path:process.execPath,args:[__dirname,'--production','--hidden']});
      else app.setLoginItemSettings({openAtLogin:patch.launchAtLogin,args:['--hidden']});
    }
    if(Object.hasOwn(patch,'autoCheckUpdates')&&patch.autoCheckUpdates&&!development&&UPDATES_SUPPORTED)void updateScheduler.tick({force:true});
  }else if(action==='watchFolder'||action==='chooseWatchFolder'){const response=await dialog.showOpenDialog(window,{properties:['openDirectory']});if(response.filePaths[0]){store.modify('setSettings',{patch:{watchFolders:[...store.data.settings.watchFolders,response.filePaths[0]]}});configureWatchers();}}
  else if(action==='unwatchFolder'){const index=payload.index;if(!Number.isInteger(index)||index<0||index>=store.data.settings.watchFolders.length)throw new Error('Invalid watched folder');store.modify('setSettings',{patch:{watchFolders:store.data.settings.watchFolders.filter((_v,i)=>i!==index)}});configureWatchers();}
  else if(action==='checkUpdates'||action==='refreshUpdates'){if(!UPDATES_SUPPORTED&&githubUpdates){await githubUpdates.check({silent:false});}else if(development&&githubUpdates){await githubUpdates.check({silent:false});}else if(development){updates.set({status:'development',message:'Development builds use a separate library. Install an official release to use its signed update channel.'});}else await updates.check({force:action==='checkUpdates'});}
  else if(action==='installUpdate'){
    if(development)throw new Error('Development builds cannot install official updates.');
    if(!UPDATES_SUPPORTED)throw new Error('Windows installer can run only on Windows.');
    await updates.install(launchInstaller);app.quit();
  }else if(action==='quit')app.quit();
  else throw new Error('Unknown command');
  const packet=broadcast({surfaceOnly:['show','search','hide','library','settings','windowClose','windowMinimize','windowMaximize','dragStartOverlay','dragEndOverlay'].includes(action)});return result===undefined?packet:{...packet,result};
}

let applicationIcon;
function appIcon(){
  if(!applicationIcon){
    applicationIcon=nativeImage.createFromPath(path.join(__dirname,'assets','clipboardline.png'));
    if(applicationIcon.isEmpty())throw new Error('The ClipBoardLine application icon is missing.');
  }
  return applicationIcon;
}
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
  store=new Store(app.getPath('userData'));
  output=new OutputActions({store,settings:()=>store.data.settings,home:require('node:os').homedir(),configHome:process.env.XDG_CONFIG_HOME||path.join(require('node:os').homedir(),'.config'),
    runtimeDir:process.env.XDG_RUNTIME_DIR,assetsDir:path.join(__dirname,'assets'),ocrBundledDir:bundledOcrDirectory(),
    language:outputLanguage,
    dialog:{showSaveDialog:options=>desiredVisible&&window?.isVisible()?dialog.showSaveDialog(window,options):dialog.showSaveDialog(options)},
    writeText:text=>writeMarkedClipboard({'text/plain':new Blob([text],{type:'text/plain'})}),
    reveal:file=>shell.showItemInFolder(file),notify:announce,
    print:file=>printWithWindow(file,{BrowserWindow,directory:output.tempDirectory}),
    ocr:(id,languages)=>ocr(id,true,languages)});
  mediaJobs=new MediaJobs({directory:path.join(store.directory,'media-jobs')});try{dragFiles=new DragFiles(store.directory);}catch{}updates=new Updates(path.join(store.directory,'updates'),{build:BUILD_NUMBER,version:app.getVersion(),changed:()=>broadcast(),available:updateAvailable});
  githubUpdates=new GitHubUpdates({currentVersion:require('./package.json').version||app.getVersion(),changed:()=>{refreshTray();broadcast();},available:updateAvailable});
  updateScheduler=new AutomaticUpdateScheduler(updates,{enabled:()=>UPDATES_SUPPORTED&&!development&&!testMode&&store.data.settings.autoCheckUpdates});
  const searchPaths=modelPaths({packaged:app.isPackaged,resourcesPath:process.resourcesPath,sourceDirectory:__dirname});
  let ortModule=null,runtimeDirectory=null;try{ortModule=require.resolve('onnxruntime-web/wasm').replace(/app[.]asar([\\/])/,'app.asar.unpacked$1');runtimeDirectory=path.dirname(ortModule);}catch{}
  imageSearch=new ImageSearch({...searchPaths,ortModule,runtimeDirectory,cacheDirectory:path.join(store.directory,'image-search'),items:()=>store.data.items,readImage:readSemanticImage,changed:()=>broadcast()});refreshImageSearch();
  protocol.handle('appmedia',async request=>{
    try{
      if(testMode&&mediaDiagnostics.length<100)mediaDiagnostics.push({method:request.method,origin:request.headers.get('Origin'),initiator:request.initiatorOrigin??null});
      // CORS permits the local editor to export its canvas.
      // Sender/frame controls remain the application authorization boundary;
      // origin checks here also reject remote-site media reads.
      const corsOrigin=mediaOrigin({method:request.method,origin:request.headers.get('Origin'),initiator:request.initiatorOrigin});
      if(!corsOrigin)return new WebResponse('Not found',{status:404});
      const url=new URL(request.url);
      const pendingMatch=/^\/pending\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(url.hostname==='media'&&pendingMatch&&pendingCapture&&pendingCapture.id===pendingMatch[1]&&pendingCapture.previewJpeg){
        return new WebResponse(pendingCapture.previewJpeg,{status:200,headers:{'Content-Type':'image/jpeg','Access-Control-Allow-Origin':corsOrigin,'Cache-Control':'no-store'}});
      }
      const match=/^\/([0-9a-f-]{36})(\/original|\/thumbnail|\/video(?:\/original)?)?$/.exec(url.pathname);
      if(url.hostname!=='media'||!match||url.hash)return new WebResponse('Not found',{status:404});
      let file,mime='image/png';
      if(match[2]==='/thumbnail'){const item=store.item(match[1]);if(!/^[a-f0-9]{64}\.png$/.test(item.thumbnailFile||''))return new WebResponse('Not found',{status:404});file=path.join(store.mediaDirectory,item.thumbnailFile);if(fs.lstatSync(file).isSymbolicLink())return new WebResponse('Not found',{status:404});}
      else if(match[2]?.startsWith('/video')){const item=store.item(match[1]);if(!item.recording)return new WebResponse('Not found',{status:404});file=store.mediaPath(item.id,match[2]==='/video/original');mime=path.extname(file)==='.mov'?'video/quicktime':'video/mp4';}
      else file=store.posterPath(match[1],match[2]==='/original');
      if(!mediaGenerationMatches(url.search,match[2],file))return new WebResponse('Not found',{status:404});
      return mediaResponse(file,{mime,origin:corsOrigin,range:request.headers.get('Range'),Response:WebResponse});
    }catch{return new WebResponse('Not found',{status:404});}
  });
  window=new BrowserWindow({width:1200,height:760,minWidth:1,minHeight:1,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,skipTaskbar:true,alwaysOnTop:true,icon:appIcon(),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:testMode}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==entry)event.preventDefault();});
  window.webContents.on('will-frame-navigate',event=>{if(!event.isMainFrame||event.url!==entry)event.preventDefault();});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.on('focus',()=>{if(!showing&&!pastePromise)previous=pasteTargets.reenter();});
  window.on('close',event=>{finishShortcutRecording();if(!closing){event.preventDefault();void hide();}});
  window.on('resize',()=>{if(applyingBounds)return;rememberNormalBounds();broadcast({surfaceOnly:true});});window.on('move',rememberNormalBounds);window.on('maximize',()=>{if(applyingBounds)return;rememberNormalBounds();broadcast({surfaceOnly:true});});window.on('unmaximize',()=>{if(applyingBounds)return;rememberNormalBounds();broadcast({surfaceOnly:true});});
  window.webContents.on('did-finish-load',()=>{lastBroadcastLibraryRevision=-1;});
  ipcMain.handle('clipboardline:state',event=>{trusted(event);return state();});
  ipcMain.on('clipboardline:shelf-motion-finished',(event,value)=>{trusted(event);shelfMotion.acknowledge(value);});
  ipcMain.on('clipboardline:capture-ready',(event,captureId)=>{trusted(event);const entry=captureReadyWaiters.get(captureId);if(entry)entry.done();});
  ipcMain.handle('clipboardline:command',async(event,action,payload)=>{trusted(event);try{return await command(action,payload);}catch(error){if(!error?.announced)notify(error.message);return state({error:error.message});}});
  window.on('blur',()=>{if(shortcutRecording){finishShortcutRecording();broadcast({surfaceOnly:true});}});
  window.on('hide',()=>finishShortcutRecording());
  window.webContents.on('render-process-gone',()=>finishShortcutRecording());
  window.webContents.on('did-start-navigation',()=>finishShortcutRecording());
  await window.loadURL(entry);
  monitor=native.monitor(
    event=>{if(!testMode)void enqueueClipboard(event);},
    error=>{monitor?.kill();monitor=null;pasteTargets.clear();if(!closing)notify(error.message+' Falling back to bounded clipboard polling.');},
    focus=>pasteTargets.observe(focus),
    ()=>{},
    point=>{try{const dip=typeof screen.screenToDipPoint==='function'?screen.screenToDipPoint(point):point;const d=getActiveDisplay(dip);if(d)lastClickDisplayId=d.id;}catch{}}
  );
  if(!testMode||testTray){
    if(process.platform==='win32')app.setAppUserModelId('com.clipboardline.desktop.windows');
    createTray();
  }
  if(!testMode){
    updates.announce();
    configureShortcuts();configureWatchers();

    clipboardTimer=setInterval(()=>{if(!monitor)void readClipboard();},1000);
    let topEdgeHotSince=0;
    const edgeTimer=setInterval(()=>{
      if(closing||showing||hidePromise||desiredVisible)return void(topEdgeHotSince=0);
      try{
        const cursor=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(cursor);
        const atTopEdge=cursor.y<=display.bounds.y+2&&cursor.x>display.bounds.x+80&&cursor.x<display.bounds.x+display.bounds.width-80;
        if(atTopEdge){
          if(!topEdgeHotSince)topEdgeHotSince=Date.now();
          else if(Date.now()-topEdgeHotSince>=260){topEdgeHotSince=0;void show('shelves');}
        }else topEdgeHotSince=0;
      }catch{topEdgeHotSince=0;}
    },120);
    edgeTimer.unref?.();
    retentionTimer=setInterval(()=>{store.expire();refreshImageSearch();broadcast();},3600000);
    if(UPDATES_SUPPORTED){updateTimer=setInterval(()=>void updateScheduler.tick(),60000);
    updateLaunchTimer=setTimeout(()=>void updateScheduler.tick(),10000);updateLaunchTimer.unref();
    powerMonitor.on('resume',()=>void updateScheduler.tick());}
    else if(githubUpdates){
      updateLaunchTimer=setTimeout(()=>void githubUpdates.check({silent:true}),8000);updateLaunchTimer.unref();
      updateTimer=setInterval(()=>void githubUpdates.check({silent:true}),2*60*60*1000);updateTimer.unref();
      powerMonitor.on('resume',()=>void githubUpdates.check({silent:true}));
    }
  }
  const startHidden = process.argv.some(arg => ['--hidden', '--background', '--tray', '--daemon', '--startup'].includes(arg));
  if (!startHidden) {
    await show('shelves');
  }
  // Test hooks are main-process only and require an explicit isolated data path.
  if(testMode&&testFolder)global.__clipboardLineTest={store,command,state,readClipboard,writeClipboard,clipboardContent,privateClipboard,importFile,getMediaJobs:()=>mediaJobs,getWindow:()=>window,getTray:()=>({tray,presentation:trayPresentation}),getTarget:()=>previous,setTarget:value=>{previous=value;},getObservedTarget:()=>pasteTargets.reenter(),getCaptureAdmissionState:()=>({capturing,pendingClipboard}),getShortcutRecordingState:()=>({token:shortcutRecording?.token||null,suspended:shortcutRegistry?.suspended||false}),getImageSearch:()=>imageSearch,getMediaDiagnostics:()=>mediaDiagnostics.map(value=>({...value})),enableShortcuts:configureShortcuts,getUpdates:()=>updates,setUpdates:value=>{updates=value;updates.changed=()=>broadcast();updates.available=updateAvailable;updateScheduler=new AutomaticUpdateScheduler(updates,{enabled:()=>store.data.settings.autoCheckUpdates});},getUpdateScheduler:()=>updateScheduler,capture,native};
}).catch(error=>{dialog.showErrorBox('ClipBoardLine could not start',error.message);app.exit(1);});
app.on('second-instance',(_event,commandLine)=>{
  if(!window)return;
  if(Array.isArray(commandLine)&&commandLine.some(arg=>['--hidden','--background','--tray','--daemon','--startup'].includes(arg)))return;
  const isShelves=Array.isArray(commandLine)&&commandLine.some(arg=>typeof arg==='string'&&arg.includes('--shelves'));
  const isMini=Array.isArray(commandLine)&&commandLine.some(arg=>typeof arg==='string'&&arg.includes('--mini'));
  const targetView=isMini?'mini':(isShelves?'shelves':'shelves');
  if(desiredVisible&&window.isVisible()&&view===targetView){
    void hide();
  }else{
    void show(targetView);
  }
});
app.on('activate',()=>{if(window)void show('shelves');});
app.on('before-quit',()=>{closing=true;void output?.cleanup();visibilityGeneration++;shelfMotion.cancel();trayPresentation?.dispose();tray?.destroy();cancelRecordingTrims();mediaJobs?.dispose();dragFiles?.dispose();clearTimeout(imageSearchTimer);void imageSearch?.stop();clearInterval(clipboardTimer);clearInterval(retentionTimer);clearInterval(updateTimer);clearTimeout(updateLaunchTimer);monitor?.kill();watchers.forEach(w=>w.close());shortcutRegistry?.dispose();globalShortcut.unregisterAll();});
