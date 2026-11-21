'use strict';
// Runs the actual renderer handlers with a small DOM/IPC fixture. These cases
// validate UI state transitions, not browser layout or native Windows paste.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const golden=require('./fixtures/annotations-golden.json');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const os=require('node:os');
const {exportCopies}=require('../lib/export-copies.cjs');

function fixture({deferInitialState=false,initialVisible=true,queuedAnimationFrames=false,imageRaster={width:900,height:220},imageDocument=false,exporter=null,trackFocus=false}={}){
 const listeners=new Map(),nodes=new Map(),commands=[],imageLoads=[],animationFrames=[],paintCalls=[],markupCalls=[];let exportFailures=0,lastClick=null,testDocument;
 class Element{
  constructor(id=''){this.id=id;this._innerHTML='';this.textContent='';this.dataset={};this.style={};this.className='';this.value='';this.selectionStart=0;this.selectionEnd=0;this.isConnected=true;this.classList={add(){},remove(){},contains(){return false;}};}
  get innerHTML(){return this._innerHTML;}set innerHTML(value){if(trackFocus&&this.id==='app'&&lastClick)lastClick.isConnected=false;if(trackFocus&&this.id==='overlay-root'&&testDocument?.activeElement?.insideOverlay){testDocument.activeElement.isConnected=false;testDocument.activeElement=testDocument.body;}this._innerHTML=value;}
  setAttribute(){}querySelector(){if(trackFocus&&this.id==='overlay-root'&&this.innerHTML){const target=new Element();target.insideOverlay=true;return target;}return null;}querySelectorAll(){return [];}focus(){if(trackFocus&&testDocument){this.isConnected=true;testDocument.activeElement=this;}}blur(){if(trackFocus&&testDocument?.activeElement===this)testDocument.activeElement=testDocument.body;}select(){}setSelectionRange(){}scrollIntoView(){}matches(){return false;}closest(){return null;}
 }
 class TextArea extends Element{}
 class Canvas extends Element{
  constructor(id=''){super(id);this.width=900;this.height=220;}
  getBoundingClientRect(){return{left:0,top:0,width:900,height:220};}
  getContext(){const canvas=this,record=entry=>{if(canvas.id==='markup-canvas')markupCalls.push(entry);};return new Proxy({}, {get(object,key){if(key in object)return object[key];return(...args)=>{if(typeof key==='string')record(['call',key,JSON.parse(JSON.stringify(args.map(value=>value instanceof Element?'element':value)))]);if(key==='drawImage'||key==='clearRect')paintCalls.push({canvas:canvas.id,operation:key,source:args[0] instanceof FixtureImage?'original':'other'});};},set(object,key,value){object[key]=value;record(['set',key,value]);return true;}});}
  toDataURL(type='image/png'){if(exportFailures){exportFailures--;throw Object.assign(new Error('Synthetic canvas export rejection'),{name:'SecurityError'});}return 'data:'+type+';base64,iVBORw0KGgo=';}
 }
 class FixtureImage extends Element{
  constructor(){super();this.naturalWidth=imageRaster.width;this.naturalHeight=imageRaster.height;this.complete=true;}
  set src(value){imageLoads.push({url:value,crossOrigin:this.crossOrigin});if(this.onload)queueMicrotask(()=>this.onload());}
 }
 const document={body:new Element('body'),activeElement:null,querySelectorAll(){return[];},getElementById(id){if(!nodes.has(id))nodes.set(id,(id==='markup-canvas'||id==='capture-canvas')?new Canvas(id):new Element(id));return nodes.get(id);},createElement(tag){return tag==='canvas'?new Canvas():new Element();},querySelector(){return null;},addEventListener(name,listener){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(listener);}};testDocument=document;
 const image='00000000-0000-4000-8000-000000000001',text1='00000000-0000-4000-8000-000000000002',text2='00000000-0000-4000-8000-000000000003',link='00000000-0000-4000-8000-000000000004';
 const base=(id,kind,createdAt,extra)=>({id,kind,createdAt,updatedAt:createdAt,name:'',title:'',text:'',url:'',pinned:false,folderIds:[],tags:[],trashedAt:null,hiddenFromShelf:false,...extra});
 const state={items:[base(image,'image',1000,{name:'Synthetic image',...(imageDocument?{annotations:[],crop:null}:{}),mediaUrl:'appmedia://media/'+image,originalMediaUrl:'appmedia://media/'+image+'/original'}),base(text1,'text',900,{text:'Text one'}),base(text2,'text',800,{text:'Text two'}),base(link,'link',700,{url:'https://example.com/reference',title:'Reference link'})],folders:[],settings:{visibleKinds:['image','text','link'],retentionDays:{image:30,text:30,link:30},shortcuts:{toggle:'Control+Alt+Space',search:'Control+Alt+S'},localShortcuts:{},language:'en',theme:'soft',cardSize:'medium'},view:'shelves',version:'1.7.0',windowVisible:initialVisible,canUndo:false,canUndoTrash:false,libraryRevision:0};
 const outputConfig={info:{defaultFolder:'/home/u/Pictures',formats:['png','jpg','webp'],format:'png',apps:[{id:'org.kde.gwenview',name:'Gwenview'}],languages:[{code:'eng',name:'English'},{code:'tur',name:'Turkish'}],defaultLanguages:['eng','tur'],shareAvailable:false,codeAvailable:true},plan:{token:'tok-1',path:'/home/u/Pictures/a.png',format:'png',quality:90},write:{path:'/home/u/Pictures/a.png'},runResults:[]};
 let subscriber,removed=[],trashRemoved=[],cleanupFailures=0,editFailures=0,delayedReply=null,releaseInitialState,deferredImageBroadcast=null,pendingImageBroadcast=null;
 const clone=value=>structuredClone(value);
 const api={emit(patch){Object.assign(state,patch);subscriber?.(clone(state));},surface(patch){Object.assign(state,patch);subscriber?.({surfaceOnly:true,...clone(patch)});},state:async()=>{const initial=clone(state);if(deferInitialState)await new Promise(resolve=>{releaseInitialState=resolve;});return initial;},subscribe(fn){subscriber=fn;return()=>{};},async command(action,payload={}){commands.push({action,payload:clone(payload)});const selected=state.items.filter(item=>(payload.ids||[payload.id]).includes(item.id));
  let cleanupError,trashResult;if(action==='cleanup'){if(cleanupFailures){cleanupFailures--;cleanupError='Permanent deletion cleanup is still pending.';}else state.needsDeletionCleanup=false;}
  // Runs the shipped export implementation and reports like main.cjs does.
  if(action==='export'&&exporter){try{state.message=(await exporter(selected)).message;}catch(error){cleanupError=error.message;}}
  if(action==='editText'){if(editFailures){editFailures--;cleanupError='Synthetic draft write failure';}else selected.forEach(item=>item.text=payload.text);}
  if(action==='setSettings'){const patch=payload.patch||{},localShortcuts={...state.settings.localShortcuts,...patch.localShortcuts};for(const [action,value]of Object.entries(localShortcuts))if(value===null)delete localShortcuts[action];state.settings={...state.settings,...patch,localShortcuts};}
  if(action==='saveImage')selected.forEach(item=>{item.crop=clone(payload.crop);item.annotations=clone(payload.annotations);});
  if(action==='pin')selected.forEach(item=>item.pinned=typeof payload.value==='boolean'?payload.value:!item.pinned);
  if(action==='name')selected.forEach(item=>{item.name=payload.name;item.pinned=true;});
  if(action==='remove'){removed=selected.map(clone);selected.forEach(item=>{if(item.pinned)item.hiddenFromShelf=true;else item.trashedAt=Date.now();});state.canUndo=true;}
  if(action==='undo'){for(const before of removed)Object.assign(state.items.find(item=>item.id===before.id),before);state.canUndo=false;}
  if(action==='trashUndoably'){trashRemoved=selected.filter(item=>!item.trashedAt).map(clone);trashResult={ids:trashRemoved.map(item=>item.id)};selected.forEach(item=>{item.trashedAt=Date.now();item.hiddenFromShelf=true;});state.canUndoTrash=trashRemoved.length>0;}
  if(action==='undoTrash'){trashResult={ids:trashRemoved.map(item=>item.id)};for(const before of trashRemoved)Object.assign(state.items.find(item=>item.id===before.id),before);trashRemoved=[];state.canUndoTrash=false;}
  if(action==='copy'&&!payload.keepOpen||action==='paste'||action==='hide')state.windowVisible=false;
  let captured;if(action==='commitCapture'&&outputConfig.captureId){captured={id:outputConfig.captureId};state.items.unshift(base(captured.id,'image',2000,{name:'Captured',mediaUrl:'appmedia://media/'+captured.id,originalMediaUrl:'appmedia://media/'+captured.id+'/original'}));state.view='shelves';state.windowVisible=false;}
  if(action==='show'){state.view='shelves';state.windowVisible=true;state.viewEvent={serial:String(commands.length)};}
  if(action==='library'||action==='settings'){state.view=action;state.windowVisible=true;}
  const output=clone(state);if(trashResult)output.result=trashResult;if(captured)output.result=captured;if(action==='outputInfo')output.result=clone(outputConfig.info);if(action==='outputPlan')output.result=clone(outputConfig.plan);if(action==='outputWrite')output.result=clone(outputConfig.write);if(action==='outputRun')output.result=outputConfig.runResults.length?outputConfig.runResults.shift():{};if(cleanupError)output.result={error:cleanupError};
  if(action==='saveImage'&&deferredImageBroadcast){const pending=deferredImageBroadcast;deferredImageBroadcast=null;pendingImageBroadcast=output;if(pending.surface)subscriber?.({surfaceOnly:true,windowVisible:true});}
  else subscriber?.(output);
  if(delayedReply?.action===action){const pending=delayedReply;delayedReply=null;await pending.promise;}
  return output;
 }};
 const context={window:{clipboardLine:api,addEventListener(name,listener){if(!listeners.has('window:'+name))listeners.set('window:'+name,[]);listeners.get('window:'+name).push(listener);}},document,HTMLElement:Element,HTMLTextAreaElement:TextArea,Image:FixtureImage,console,structuredClone,URL,Set,Date,JSON,Math,Number,String,requestAnimationFrame:fn=>queuedAnimationFrames?animationFrames.push(fn):fn(),setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../locales.js'),'utf8'),context,{filename:'locales.js'});vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/annotations.cjs'),'utf8'),context,{filename:'lib/annotations.cjs'});const engine=context.window.clipboardLineAnnotations,engineDraw=engine.drawAnnotations,drawn=[];engine.drawAnnotations=(ctx,annotations,options)=>{drawn.push({annotations:structuredClone(annotations),clip:options?.clip?structuredClone(options.clip):null,base:options?.base??null});return engineDraw(ctx,annotations,options);};vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8'),context,{filename:'renderer.js'});
 async function ready(){await new Promise(setImmediate);}
 async function key(code,{ctrl=false,alt=false,shift=false,key,target,composing=false,keyCode=0}={}){const event={code,key:key||(/^Key/.test(code)?code.slice(3).toLowerCase():code==='Space'?' ':code),ctrlKey:ctrl,metaKey:false,altKey:alt,shiftKey:shift,repeat:false,isComposing:composing,keyCode,target:target||new Element(),preventDefault(){this.prevented=true;}};for(const listener of listeners.get('keydown')||[])await listener(event);await ready();return event;}
 async function click(action,extra={}){const target=new Element();target.dataset.action=action;Object.assign(target.dataset,extra);if(action==='record-local'||action==='record-global')target.id='settings-'+action+'-'+extra.keyAction;target.closest=selector=>selector==='[data-action]'?target:null;lastClick=target;if(trackFocus)target.focus();for(const listener of listeners.get('click')||[])listener({target,stopPropagation(){}});await ready();}
 async function pointer(type,x,y,{shift=false,canvas='markup-canvas'}={}){const target=document.getElementById(canvas);for(const listener of listeners.get(type)||[])listener({target,clientX:x,clientY:y,pointerId:1,shiftKey:shift,preventDefault(){}});await ready();}
 async function dispatch(type,{canvas='capture-canvas',...extra}={}){const target=document.getElementById(canvas),event={target,preventDefault(){this.prevented=true;},...extra};for(const listener of listeners.get(type)||[])await listener(event);await ready();return event;}
 async function input(id,value){const target=document.getElementById(id);target.value=value;target.selectionStart=value.length;for(const listener of listeners.get('input')||[])await listener({target});await ready();}
 async function change(id,value){const target=document.getElementById(id);target.value=value;for(const listener of listeners.get('change')||[])await listener({target});await ready();}
 return{drawn,outputConfig,get menu(){return nodes.get('output-menu-root')?.innerHTML||'';},async cardClick(id,{ctrl=false}={}){const card=new Element();card.dataset.itemId=id;card.closest=selector=>selector==='[data-item-id]'?card:null;for(const listener of listeners.get('click')||[])await listener({target:card,ctrlKey:ctrl,metaKey:false,shiftKey:false,stopPropagation(){}});await ready();},grid(columns){document.querySelectorAll=selector=>selector==='.library-grid > .card'?[...document.getElementById('app').innerHTML.matchAll(/<article class="[^"]*"[^>]*data-item-id="([^"]+)"/g)].map((match,index)=>({offsetTop:Math.floor(index/columns)*200,dataset:{itemId:match[1]}})):[];},editor(id){const node=document.getElementById(id);node.tagName='INPUT';node.matches=selector=>selector.includes('input');return node;},ready,key,dispatch,input,change,click,pointer,async blur(){for(const listener of listeners.get('window:blur')||[])listener();await ready();},imageLoads,paintCalls,markupCalls,animationFrames,flushAnimationFrames(){for(const fn of animationFrames.splice(0))fn();},releaseInitialState(){releaseInitialState?.();},deferReply(action){let release;const promise=new Promise(resolve=>{release=resolve;});delayedReply={action,promise};return release;},deferImageBroadcast({surface=true}={}){deferredImageBroadcast={surface};},releaseImageBroadcast(){const next=pendingImageBroadcast;pendingImageBroadcast=null;if(next)subscriber?.(next);},failExportOnce(){exportFailures++;},failCleanupOnce(){cleanupFailures++;},failEditOnce(){editFailures++;},state,commands,nodes,image,text1,text2,link,api,get main(){return nodes.get('app').innerHTML;},get overlay(){return nodes.get('overlay-root').innerHTML;},get focused(){return document.activeElement;},get lastClick(){return lastClick;}};
}

function selectedCards(f){return [...f.main.matchAll(/<article class="([^"]*)"[^>]*data-item-id="([^"]+)"/g)].filter(match=>match[1].split(' ').includes('selected')).map(match=>match[2]);}
function activeKind(f){return f.main.match(/class="shelf active-shelf" data-shelf="([^"]+)"/)?.[1];}
function focusedCard(f){return [...f.main.matchAll(/<article class="([^"]*)"[^>]*data-item-id="([^"]+)"/g)].find(match=>match[1].split(' ').includes('focused'))?.[2];}
function navigationItems(f,{image=13,text=11,link=10}={}){let serial=0;const values={};for(const [kind,count]of Object.entries({image,text,link})){const source=f.state.items.find(value=>value.kind===kind);values[kind]=Array.from({length:count},(_,index)=>({...structuredClone(source),id:'10000000-0000-4000-8000-'+String(++serial).padStart(12,'0'),createdAt:10000-index,name:kind==='image'?'Navigation image '+index:'',text:kind==='text'?'Navigation text '+index:'',title:kind==='link'?'Navigation link '+index:'',url:kind==='link'?'https://example.com/navigation/'+index:''}));}return values;}

test('fresh shelves select only the first image; P pins it; Space previews it',async()=>{const f=fixture();await f.ready();assert.match(f.main,/card kind-image focused selected/);assert.deepEqual(selectedCards(f),[f.image]);await f.key('KeyP');assert.equal(f.state.items[0].pinned,true);await f.key('Space');assert.match(f.overlay,/id="preview-dialog"/);assert.match(f.overlay,/aria-label="Synthetic image"/);});

test('lightweight native toggles retain current content and reset to a single first-image selection',async()=>{
 const f=fixture();await f.ready();for(let index=0;index<8;index++){
  await f.key('ArrowDown');assert.equal(activeKind(f),'text');await f.key('ArrowRight');
  f.api.surface({view:'shelves',windowVisible:false});await f.ready();assert.deepEqual(selectedCards(f),[]);
  f.api.surface({view:'shelves',windowVisible:true});await f.ready();assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[f.image]);assert.match(f.main,/Text two/);
 }
 f.api.emit({items:f.state.items.map(value=>value.id===f.text1?{...value,text:'Latest hidden edit'}:value)});await f.ready();f.api.surface({windowVisible:false});f.api.surface({windowVisible:true});await f.ready();await f.key('ArrowDown');await f.key('Space');assert.match(f.overlay,/Latest hidden edit/);assert.deepEqual(selectedCards(f),[f.text1]);
});

test('a lightweight toggle before the first full snapshot preserves the later visibility event',async()=>{
 const f=fixture({deferInitialState:true,initialVisible:false});f.api.surface({view:'shelves',windowVisible:true});f.releaseInitialState();await f.ready();assert.deepEqual(selectedCards(f),[f.image]);assert.equal(activeKind(f),'image');await f.key('Space');assert.match(f.overlay,/Synthetic image/);
 const hidden=fixture({deferInitialState:true,initialVisible:true});hidden.api.surface({view:'shelves',windowVisible:false});hidden.releaseInitialState();await hidden.ready();assert.deepEqual(selectedCards(hidden),[]);assert.equal(hidden.overlay,'');
});

test('lightweight native hide saves a dirty text preview before clearing it and reopening',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('Space');await f.key('KeyE');await f.input('text-editor','Draft saved before lightweight hide');
 f.api.surface({view:'shelves',windowVisible:false});await f.ready();assert.equal(f.state.items.find(value=>value.id===f.text1).text,'Draft saved before lightweight hide');assert.equal(f.commands.filter(value=>value.action==='editText').length,1);assert.equal(f.overlay,'');
 f.api.surface({view:'shelves',windowVisible:true});await f.ready();assert.deepEqual(selectedCards(f),[f.image]);assert.equal(f.overlay,'');await f.key('ArrowDown');await f.key('Space');assert.match(f.overlay,/Draft saved before lightweight hide/);
});

test('new full content survives later lightweight visibility packets while an editor save is pending',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('Space');await f.key('KeyE');const release=f.deferReply('editText');await f.input('text-editor','Saved pending draft');
 f.api.surface({view:'shelves',windowVisible:false});await f.ready();f.api.emit({items:f.state.items.map(value=>value.id===f.image?{...value,name:'Current image title',mediaUrl:'appmedia://media/'+f.image+'?v=new'}:value.id===f.text2?{...value,text:'Current second text'}:value),libraryRevision:7});
 f.api.surface({view:'shelves',windowVisible:true,libraryRevision:7,viewEvent:{serial:'after-pending-save',selectId:f.text2,kind:'text',preview:true}});await f.ready();release();await f.ready();
 assert.match(f.main,/Current image title/);assert.match(f.main,new RegExp('appmedia://media/'+f.image+'\\?v=new'));assert.match(f.overlay,/Current second text/);assert.doesNotMatch(f.overlay,/id="text-editor"/);assert.equal(f.state.items.find(value=>value.id===f.text1).text,'Saved pending draft');assert.equal(f.state.windowVisible,true);assert.deepEqual(selectedCards(f),[f.text2]);
});

test('an initial library older than a queued lightweight revision is refreshed before it is shown',async()=>{
 const f=fixture({deferInitialState:true,initialVisible:false});f.state.libraryRevision=2;f.state.items=f.state.items.map(value=>value.id===f.image?{...value,name:'Current bootstrap image'}:value);f.api.surface({view:'shelves',windowVisible:true,libraryRevision:2});f.releaseInitialState();await f.ready();
 // The fresh API read also uses the controllable initial-state gate.
 f.releaseInitialState();await f.ready();assert.match(f.main,/Current bootstrap image/);assert.deepEqual(selectedCards(f),[f.image]);assert.equal(activeKind(f),'image');
});

test('preview arrows move across shelf kinds, S keeps preview on neighbor, Backspace restores',async()=>{const f=fixture();await f.ready();await f.key('Space');await f.key('ArrowDown');assert.match(f.overlay,/aria-label="Text one"/);await f.key('KeyS');assert.match(f.overlay,/aria-label="Text two"/);assert.ok(f.state.items.find(item=>item.id===f.text1).trashedAt);await f.key('Backspace');assert.match(f.overlay,/aria-label="Text one"/);assert.equal(f.state.items.find(item=>item.id===f.text1).trashedAt,null);});

test('Undo take down that leaves a copied-again text in Trash keeps the selection and preview where they are',async()=>{
 const f=fixture();await f.ready();await f.key('Space');await f.key('ArrowDown');await f.key('KeyS');assert.match(f.overlay,/aria-label="Text two"/);
 const command=f.api.command;f.api.command=async(action,payload)=>action==='undo'?structuredClone(f.state):command(action,payload);
 await f.key('Backspace');assert.ok(f.state.items.find(item=>item.id===f.text1).trashedAt);assert.match(f.overlay,/aria-label="Text two"/);assert.doesNotMatch(f.overlay,/empty-preview/);assert.deepEqual(selectedCards(f),[f.text2]);
});

test('removing the final preview item keeps an empty Undo view and Backspace restores that exact item',async()=>{
 for(const pinned of [false,true]){
  const f=fixture();await f.ready();f.api.emit({items:[{...f.state.items[0],pinned}]});await f.ready();await f.key('Space');await f.key('KeyS');
  assert.match(f.overlay,/id="preview-dialog"/);assert.match(f.overlay,/empty-preview/);assert.match(f.overlay,/data-action="undo"/);
  const before=f.commands.length;await f.key('KeyC',{ctrl:true});await f.key('KeyP');assert.equal(f.commands.length,before,'empty preview must not copy or mutate its removed item');
  await f.key('Backspace');assert.match(f.overlay,/aria-label="Synthetic image"/);assert.doesNotMatch(f.overlay,/empty-preview/);assert.deepEqual(selectedCards(f),[f.image]);
  assert.equal(f.state.items[0].trashedAt,null);assert.equal(f.state.items[0].hiddenFromShelf,false);
  await f.key('KeyS');assert.match(f.overlay,/empty-preview/);await f.key('Escape');assert.equal(f.overlay,'');assert.equal(f.state.windowVisible,true);
 }
});

test('preview CtrlC keeps open; Enter copies exact current item and dismisses',async()=>{const f=fixture();await f.ready();await f.key('Space');await f.key('ArrowDown');await f.key('KeyC',{ctrl:true});assert.equal(f.commands.at(-1).action,'copy');assert.equal(f.commands.at(-1).payload.keepOpen,true);assert.match(f.overlay,/id="preview-dialog"/);await f.key('Enter');assert.equal(f.commands.at(-1).payload.ids[0],f.text1);assert.equal(f.commands.at(-1).payload.keepOpen,false);assert.equal(f.state.windowVisible,false);assert.equal(f.overlay,'');});

test('L opens Library; CtrlK action search closes with Escape',async()=>{const f=fixture();await f.ready();await f.key('KeyL');assert.equal(f.state.view,'library');assert.match(f.main,/Library results/);await f.key('KeyK',{ctrl:true});assert.match(f.overlay,/Search actions/);await f.key('Escape');assert.equal(f.overlay,'');});

test('AltP sequential naming saves one then advances and Escape leaves remaining item unchanged',async()=>{const f=fixture();await f.ready();await f.key('Tab');await f.key('KeyA',{ctrl:true});await f.key('KeyP',{alt:true});assert.match(f.overlay,/1 \/ 2/);await f.input('name-input','First named note');await f.key('Enter');assert.equal(f.state.items.find(item=>item.id===f.text1).name,'First named note');assert.equal(f.state.items.find(item=>item.id===f.text1).pinned,true);assert.match(f.overlay,/2 \/ 2/);await f.key('Escape');assert.equal(f.state.items.find(item=>item.id===f.text2).name,'');assert.equal(f.state.items.find(item=>item.id===f.text2).pinned,false);});

test('ShiftS searches enabled rows and native reopen resets to only the first image',async()=>{const f=fixture();await f.ready();await f.key('KeyS',{shift:true});await f.input('search-input','Text two');assert.match(f.main,/Text two/);assert.doesNotMatch(f.main,/Text one/);await f.key('Escape');await f.key('Tab');await f.key('ArrowRight');assert.match(f.main,/card kind-text focused selected[^>]*data-item-id="00000000-0000-4000-8000-000000000003"/);await f.key('Enter');await f.api.command('show');await f.ready();assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[f.image]);});


test('Settings retries pending deletion cleanup without clearing failure or deleting another record',async()=>{const f=fixture();await f.ready();await f.api.command('settings');await f.ready();assert.doesNotMatch(f.main,/data-action="retry-cleanup"/);const original=f.state.items.map(item=>item.id);f.state.needsDeletionCleanup=true;await f.api.command('settings');await f.ready();assert.match(f.main,/data-action="retry-cleanup"/);f.failCleanupOnce();await f.click('retry-cleanup');assert.equal(f.commands.at(-1).action,'cleanup');assert.deepEqual(f.commands.at(-1).payload,{});assert.equal(f.state.needsDeletionCleanup,true);assert.match(f.main,/data-action="retry-cleanup"/);assert.deepEqual(f.state.items.map(item=>item.id),original);await f.click('retry-cleanup');assert.equal(f.state.needsDeletionCleanup,false);assert.doesNotMatch(f.main,/data-action="retry-cleanup"/);assert.deepEqual(f.state.items.map(item=>item.id),original);});


test('native Settings state closes the screenshot crop preview instead of covering Settings',async()=>{const f=fixture();await f.ready();f.api.emit({viewEvent:{serial:'synthetic-capture',selectId:f.image,kind:'image',preview:true,crop:true}});await f.ready();assert.match(f.overlay,/id="preview-dialog"/);assert.match(f.overlay,/id="markup-canvas"/);await f.api.command('settings');await f.ready();assert.equal(f.overlay,'');assert.match(f.main,/class="settings-main"/);assert.match(f.main,/data-setting="theme"/);});

test('native view transition saves the current text draft once before clearing preview',async()=>{const f=fixture();await f.ready();await f.key('Tab');await f.key('Space');await f.key('KeyE');await f.input('text-editor','Edited before native Settings');await f.api.command('settings');await f.ready();assert.equal(f.state.items.find(item=>item.id===f.text1).text,'Edited before native Settings');assert.equal(f.commands.filter(command=>command.action==='editText').length,1);assert.equal(f.overlay,'');assert.match(f.main,/class="settings-main"/);});

test('failed native transition retains text draft until a successful explicit retry',async()=>{const f=fixture();await f.ready();await f.key('Tab');await f.key('Space');await f.key('KeyE');f.failEditOnce();f.failEditOnce();await f.input('text-editor','Keep this unsaved draft');await f.api.command('settings');await f.ready();assert.match(f.overlay,/id="text-editor"/);assert.match(f.overlay,/Keep this unsaved draft/);assert.equal(f.state.items.find(item=>item.id===f.text1).text,'Text one');assert.doesNotMatch(f.main,/class="settings-main"/);await f.click('finish-text');assert.equal(f.state.items.find(item=>item.id===f.text1).text,'Keep this unsaved draft');assert.equal(f.overlay,'');assert.match(f.main,/class="settings-main"/);});

test('native hide clears clean preview and does not leave it on the next opening',async()=>{const f=fixture();await f.ready();await f.key('Space');assert.match(f.overlay,/id="preview-dialog"/);await f.api.command('hide');await f.ready();assert.equal(f.overlay,'');await f.api.command('show');await f.ready();assert.equal(f.overlay,'');});


test('editor requests anonymous CORS before loading managed original',async()=>{const f=fixture();await f.ready();await f.key('Space');await f.key('KeyC');assert.equal(f.imageLoads.length,1);assert.equal(f.imageLoads[0].crossOrigin,'anonymous');assert.match(f.imageLoads[0].url,/\/original$/);});

test('a click without a drag in crop mode leaves the image uncropped like macOS',async()=>{
 const f=fixture({imageDocument:true});await f.ready();await f.key('Space');await f.key('KeyC');
 await f.pointer('pointerdown',300,100);await f.pointer('pointerup',300,100);await f.key('Enter');
 assert.deepEqual(f.commands.filter(value=>value.action==='saveImage'),[]);
});
test('canvas export rejection retains dirty crop and explicit Enter retry saves it',async()=>{const f=fixture();await f.ready();await f.key('Space');await f.key('KeyC');await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);f.failExportOnce();await f.key('Enter');assert.match(f.overlay,/id="markup-canvas"/);assert.equal(f.commands.filter(command=>command.action==='saveImage').length,0);assert.match(f.nodes.get('toast').textContent,/Image changes could not be saved/);await f.key('Enter');assert.doesNotMatch(f.overlay,/id="markup-canvas"/);assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,{x:60,y:30,width:440,height:120});});

for(const ordering of ['broadcast before reply','reply before broadcast','unrelated surface before reply'])test('preview crop undo and redo survive '+ordering,async()=>{
 const f=fixture({imageDocument:true});await f.ready();await f.key('Space');await f.key('KeyC');await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);
 if(ordering!=='broadcast before reply')f.deferImageBroadcast({surface:ordering==='unrelated surface before reply'});
 await f.key('Enter');assert.doesNotMatch(f.overlay,/id="markup-canvas"/);f.releaseImageBroadcast();await f.ready();
 const crop={x:60,y:30,width:440,height:120};assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,crop);
 await f.key('KeyZ',{ctrl:true});assert.equal(f.commands.filter(command=>command.action==='saveImage').length,2);assert.equal(f.state.items.find(item=>item.id===f.image).crop,null);assert.doesNotMatch(f.overlay,/id="markup-canvas"/);
 await f.key('KeyZ',{ctrl:true,shift:true});assert.equal(f.commands.filter(command=>command.action==='saveImage').length,3);assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,crop);
});

test('an external same-ID image edit invalidates acknowledged preview undo history',async()=>{
 const f=fixture({imageDocument:true});await f.ready();await f.key('Space');await f.key('KeyC');await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);f.deferImageBroadcast();await f.key('Enter');f.releaseImageBroadcast();await f.ready();
 const external={x:10,y:20,width:80,height:90};f.api.emit({items:f.state.items.map(value=>value.id===f.image?{...value,crop:external,mediaUrl:value.mediaUrl+'?v=external'}:value)});await f.ready();
 await f.key('KeyZ',{ctrl:true});assert.equal(f.commands.filter(command=>command.action==='saveImage').length,1);assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,external);
});

test('canvas export failure blocks native Settings until explicit Save succeeds',async()=>{const f=fixture();await f.ready();await f.key('Space');await f.key('KeyC');await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);f.failExportOnce();await f.api.command('settings');await f.ready();assert.match(f.overlay,/id="markup-canvas"/);assert.doesNotMatch(f.main,/class="settings-main"/);await f.click('save-image');assert.equal(f.overlay,'');assert.match(f.main,/class="settings-main"/);assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,{x:60,y:30,width:440,height:120});});

test('Tab saves dirty image crop before switching the open preview; Enter copies the visible text',async()=>{
 const f=fixture();await f.ready();await f.key('Space');await f.key('KeyC');
 await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);
 await f.key('Tab');
 assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,{x:60,y:30,width:440,height:120});
 assert.equal(f.commands.filter(command=>command.action==='saveImage').length,1);
 assert.match(f.overlay,/aria-label="Text one"/);
 assert.doesNotMatch(f.overlay,/editing-toolbar|id="markup-canvas"/);
 await f.key('Enter');
 assert.equal(f.commands.at(-1).action,'copy');
 assert.deepEqual(f.commands.at(-1).payload.ids,[f.text1]);
 assert.equal(f.state.windowVisible,false);assert.equal(f.overlay,'');
 assert.equal(f.commands.filter(command=>command.action==='saveImage').length,1);
});

test('failed crop export aborts Tab shelf switching and keeps the draft available for retry',async()=>{
 const f=fixture();await f.ready();await f.key('Space');await f.key('KeyC');
 await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);
 f.failExportOnce();await f.key('Tab');
 assert.match(f.overlay,/aria-label="Synthetic image"/);
 assert.match(f.overlay,/editing-toolbar/);assert.match(f.overlay,/id="markup-canvas"/);
 assert.match(f.main,/card kind-image focused selected/);
 assert.equal(f.commands.filter(command=>['saveImage','copy'].includes(command.action)).length,0);
 assert.equal(f.state.items.find(item=>item.id===f.image).crop,undefined);
 await f.key('Tab');
 assert.deepEqual(f.state.items.find(item=>item.id===f.image).crop,{x:60,y:30,width:440,height:120});
 assert.match(f.overlay,/aria-label="Text one"/);
 assert.doesNotMatch(f.overlay,/editing-toolbar|id="markup-canvas"/);
});

test('Settings hides browsing selection and keyboard hints while Library retains its footer',async()=>{
 const f=fixture();await f.ready();await f.key('KeyP');await f.api.command('library');await f.ready();
 assert.match(f.main,/class="statusbar"/);assert.match(f.main,/1 selected/);
 await f.api.command('settings');await f.ready();
 assert.match(f.main,/class="settings-main"/);
 assert.doesNotMatch(f.main,/class="statusbar"|class="key-legend"|1 selected/);
});


test('Settings browsing keys do not pin, copy or paste the last shelf selection',async()=>{const f=fixture();await f.ready();await f.api.command('settings');await f.ready();await f.key('KeyP');await f.key('Enter');await f.key('Enter',{ctrl:true});assert.equal(f.state.items.find(item=>item.id===f.image).pinned,false);assert.equal(f.commands.filter(command=>['pin','copy','paste'].includes(command.action)).length,0);await f.key('KeyK',{ctrl:true});assert.match(f.overlay,/Search actions/);});

test('fresh opening skips an empty enabled image shelf so Space and Enter operate on the first text',async()=>{
 const f=fixture();await f.ready();
 f.api.emit({items:f.state.items.filter(value=>value.kind!=='image')});
 await f.api.command('show');await f.ready();
 assert.match(f.main,/card kind-text focused selected/);
 await f.key('Space');assert.match(f.overlay,/aria-label="Text one"/);
 await f.key('Enter');
 assert.equal(f.commands.at(-1).action,'copy');
 assert.deepEqual(f.commands.at(-1).payload.ids,[f.text1]);
 assert.equal(f.state.windowVisible,false);
});

test('fresh focus skips empty or disabled kinds and safely handles every shelf empty',async()=>{
 const f=fixture();await f.ready();
 f.api.emit({items:f.state.items.filter(value=>value.kind!=='image'),settings:{...f.state.settings,visibleKinds:['image','link']}});
 await f.api.command('show');await f.ready();
 assert.match(f.main,/card kind-link focused selected/);
 await f.key('Space');assert.match(f.overlay,/aria-label="Reference link"/);
 await f.key('Escape');
 f.api.emit({items:[]});await f.api.command('show');await f.ready();
 const commands=f.commands.length;await f.key('Space');await f.key('Enter');
 assert.equal(f.overlay,'');assert.equal(f.commands.length,commands);
});

test('closed preview arrows cross shelves by full item column, clamp without wrapping, and keep Left/Right horizontal',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f);f.api.emit({items:Object.values(values).flat()});await f.ready();
 await f.key('ArrowRight',{ctrl:true});assert.equal(focusedCard(f),values.image[12].id);
 await f.key('ArrowDown');assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[values.text[10].id]);
 await f.key('ArrowDown');assert.equal(activeKind(f),'link');assert.deepEqual(selectedCards(f),[values.link[9].id]);
 await f.key('ArrowDown');assert.equal(focusedCard(f),values.link[9].id);
 await f.key('ArrowUp');assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[values.text[9].id]);
 await f.key('ArrowUp');assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[values.image[9].id]);
 await f.key('ArrowUp');assert.equal(focusedCard(f),values.image[9].id);
 await f.key('ArrowLeft');assert.equal(activeKind(f),'image');assert.equal(focusedCard(f),values.image[8].id);
 await f.key('ArrowRight');assert.equal(focusedCard(f),values.image[9].id);assert.equal(f.overlay,'');
});

test('vertical navigation skips filtered empty and hidden shelves and Space/Enter use the destination',async()=>{
 const f=fixture();await f.ready();await f.click('pinned-kind',{kind:'text'});await f.click('activate-shelf',{kind:'image'});
 await f.key('ArrowDown');assert.equal(activeKind(f),'link');assert.deepEqual(selectedCards(f),[f.link]);
 await f.key('Space');assert.match(f.overlay,/aria-label="Reference link"/);
 await f.key('ArrowUp');assert.match(f.overlay,/aria-label="Synthetic image"/);assert.deepEqual(selectedCards(f),[f.image]);
 await f.key('Escape');await f.key('KeyL',{shift:true});await f.key('ArrowDown');assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[f.image]);
 assert.doesNotMatch(f.main,/data-shelf="link"/);await f.key('Enter');assert.deepEqual(f.commands.at(-1).payload.ids,[f.image]);assert.equal(f.state.windowVisible,false);
});

test('row toggles preserve the active batch and enabling other shelves adds no selection',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('ArrowRight');await f.key('KeyA',{ctrl:true});
 assert.deepEqual(selectedCards(f),[f.text1,f.text2]);
 for(const action of ['KeyL','KeyL','KeyI','KeyI']){await f.key(action,{shift:true});assert.equal(activeKind(f),'text');assert.equal(focusedCard(f),f.text2);assert.deepEqual(selectedCards(f),[f.text1,f.text2]);}
 await f.key('KeyT',{shift:true});assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[f.image]);
 await f.key('KeyT',{shift:true});assert.deepEqual(selectedCards(f),[f.image]);assert.equal(activeKind(f),'image');
});

test('fresh native reveal clears stale search, quick pages and selection then prefers images',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f);f.api.emit({items:Object.values(values).flat()});await f.ready();
 await f.key('ArrowRight',{alt:true});assert.notEqual(focusedCard(f),values.image[0].id);
 await f.key('KeyS',{shift:true});await f.input('search-input','Navigation text 10');assert.match(f.main,/Navigation text 10/);
 await f.api.command('hide');await f.api.command('show');await f.ready();
 assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[values.image[0].id]);assert.doesNotMatch(f.main,/search-hud|search-summary/);
 await f.key('Digit1');assert.equal(focusedCard(f),values.image[0].id);
 await f.key('ArrowDown');assert.deepEqual(selectedCards(f),[values.text[0].id]);
 await f.key('Space');assert.match(f.overlay,/aria-label="Navigation text 0"/);await f.key('Enter');assert.deepEqual(f.commands.at(-1).payload.ids,[values.text[0].id]);
});

test('hidden or filtered images use first visible nonempty shelf and reopening never keeps a text default when images return',async()=>{
 const f=fixture();await f.ready();await f.key('KeyI',{shift:true});assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[f.text1]);
 await f.api.command('hide');await f.api.command('show');await f.ready();assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[f.text1]);
 await f.key('KeyI',{shift:true});assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[f.text1]);
 await f.api.command('hide');await f.api.command('show');await f.ready();assert.equal(activeKind(f),'image');assert.deepEqual(selectedCards(f),[f.image]);
 await f.click('pinned-kind',{kind:'image'});await f.api.command('hide');await f.api.command('show');await f.ready();assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[f.text1]);
});

test('native search typing stays in its editor and Shift arrows extend only the current row',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('ArrowDown',{shift:true});assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[f.text1,f.text2]);
 await f.key('KeyS',{shift:true});const editor=f.nodes.get('search-input');editor.matches=selector=>selector.includes('input');
 const before=f.commands.length;for(const code of ['Space','ArrowLeft','ArrowRight'])assert.equal((await f.key(code,{target:editor})).prevented,undefined);
 assert.equal(f.commands.length,before);assert.equal(activeKind(f),'text');assert.equal(f.overlay,'');
 await f.input('search-input','Text');await f.key('Enter',{target:editor});assert.equal(activeKind(f),'text');assert.deepEqual(selectedCards(f),[f.text1]);
 await f.key('ArrowDown');assert.equal(activeKind(f),'text','Empty result shelves do not wrap');
});

test('global native search survives a hidden resize broadcast before the same event becomes visible',async()=>{
 const f=fixture();await f.ready();await f.api.command('hide');await f.ready();
 const viewEvent={search:true,serial:'global-search-before-window-show'};
 f.api.emit({windowVisible:false,viewEvent});await f.ready();
 assert.doesNotMatch(f.main,/class="search-hud"/);assert.deepEqual(selectedCards(f),[]);
 f.api.emit({windowVisible:true,viewEvent});await f.ready();
 assert.match(f.main,/class="search-hud"/);assert.deepEqual(selectedCards(f),[f.image]);
 f.api.emit({windowVisible:true,viewEvent});await f.ready();assert.match(f.main,/class="search-hud"/);
 await f.key('Escape');assert.doesNotMatch(f.main,/class="search-hud"/);
 f.api.emit({windowVisible:true,viewEvent});await f.ready();
 assert.doesNotMatch(f.main,/class="search-hud"/,'An unchanged broadcast must not reopen a dismissed search');
});

test('native image preview and crop event wait until the hidden window is shown',async()=>{
 const f=fixture();await f.ready();await f.api.command('hide');await f.ready();
 const viewEvent={selectId:f.image,kind:'image',preview:true,crop:true,serial:'capture-before-window-show'};
 f.api.emit({windowVisible:false,viewEvent});await f.ready();assert.equal(f.overlay,'');assert.equal(f.imageLoads.length,0);
 f.api.emit({windowVisible:true,viewEvent});await f.ready();
 assert.match(f.overlay,/id="preview-dialog"/);assert.match(f.overlay,/id="markup-canvas"/);assert.equal(f.imageLoads.length,1);
 f.api.emit({windowVisible:true,viewEvent});await f.ready();assert.equal(f.imageLoads.length,1,'The same event must not recreate its editor');
});

test('late Enter-copy response cannot clear the reopened selection or preview',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('Space');assert.match(f.overlay,/aria-label="Text one"/);
 const release=f.deferReply('copy'),copying=f.key('Enter');await f.ready();
 assert.equal(f.state.windowVisible,false);assert.equal(f.overlay,'');
 await f.api.command('show');await f.ready();assert.deepEqual(selectedCards(f),[f.image]);
 await f.key('ArrowDown');await f.key('Space');assert.match(f.overlay,/aria-label="Text one"/);
 release();await copying;
 assert.equal(f.state.windowVisible,true);assert.deepEqual(selectedCards(f),[f.text1]);assert.match(f.overlay,/aria-label="Text one"/);
 await f.key('ArrowDown');assert.match(f.overlay,/aria-label="Reference link"/);assert.deepEqual(selectedCards(f),[f.link]);
});

test('late Hide response cannot replace a newer native global search opening',async()=>{
 const f=fixture();await f.ready();const release=f.deferReply('hide'),hiding=f.key('Escape');await f.ready();
 assert.equal(f.state.windowVisible,false);
 f.api.emit({windowVisible:true,viewEvent:{search:true,serial:'search-after-pending-hide'}});await f.ready();assert.match(f.main,/class="search-hud"/);
 release();await hiding;
 assert.match(f.main,/class="search-hud"/);assert.deepEqual(selectedCards(f),[f.image]);
});

test('shared macOS/Windows shelf contract runs through actual renderer handlers',async()=>{
 const contractFile=path.resolve(__dirname,'../../contracts/shelf-behavior.json'),raw=fs.readFileSync(contractFile),contract=JSON.parse(raw);
 assert.equal(contract.schemaVersion,1);assert.equal(contract.contractId,'clipboardline.shelves.v1');
 const observations=[],errors=[],directories=[],{Store}=require('../lib/model.cjs');
 try{for(const scenario of contract.scenarios){
  const f=fixture();await f.ready();let store=null;const links=new Map(),aliases=new Map(),values=contract.itemSets[scenario.itemSet].map((entry,index)=>{
   const id='20000000-0000-4000-8000-'+String(index+1).padStart(12,'0');aliases.set(id,entry.id);
   const source=f.state.items.find(value=>value.kind===entry.kind);
   return{...structuredClone(source),id,createdAt:10000-index,name:entry.kind==='image'?entry.text:'',text:entry.kind==='text'?entry.text:'',title:entry.kind==='link'?entry.text:'',url:entry.kind==='link'?'https://example.com/contract/'+entry.id:''};
  });
  const kinds=new Map(contract.itemSets[scenario.itemSet].map(entry=>[entry.id,entry.kind]));
  f.api.emit({items:values,settings:{...f.state.settings,visibleKinds:scenario.visibleKinds}});await f.ready();
  for(const kind of scenario.pinnedOnlyKinds||[])await f.click('pinned-kind',{kind});
  await f.api.command('hide');await f.ready();
  for(let index=0;index<scenario.steps.length;index++){
   const step=scenario.steps[index],commandsBefore=f.commands.length;const editor=f.nodes.get('search-input');if(editor)editor.matches=selector=>selector.includes('input');
   const searchEditing=/class="search-hud"/.test(f.main);let copied=null;
   if(step.action==='open')await f.api.command('show');
   else if(step.action==='close')await f.api.command('hide');
   else if(step.action==='remap'){const localShortcuts={...f.state.settings.localShortcuts};if(step.key===null)delete localShortcuts[step.binding];else localShortcuts[step.binding]=step.key==='KeyX'?'X':step.key;f.api.emit({settings:{...f.state.settings,localShortcuts}});}
   else if(step.action==='key')await f.key(step.code,searchEditing?{target:editor}:{});
   else if(['up','down','left','right'].includes(step.action))await f.key({up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[step.action],searchEditing?{target:editor}:{});
   else if(step.action==='toggle')await f.key({image:'KeyI',text:'KeyT',link:'KeyL'}[step.kind],{shift:true});
   else if(step.action==='switchShelf')await f.key('Tab');
   else if(step.action==='command')await f.key(step.code,step.ctrl?{ctrl:true}:{});
   else if(step.action==='openSearch')await f.key('KeyS',{shift:true});
   else if(step.action==='finishSearch')await f.key('Enter',{target:editor});
   else if(step.action==='copyLink'){
    if(!store){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-shelf-contract-'));directories.push(directory);store=new Store(directory);}
    const item=store.insert('link',step.url);if(!links.has(item.id))links.set(item.id,'link-'+(links.size+1));copied={link:{item:links.get(item.id),address:item.url}};
   }
   else throw new Error('Unsupported shared contract action: '+step.action);
   await f.ready();
   const active=activeKind(f),focusedAlias=aliases.get(focusedCard(f)),actual={activeKind:active,focused:kinds.get(focusedAlias)===active?focusedAlias:null,selected:selectedCards(f).map(id=>aliases.get(id)||id).sort(),visibleKinds:[...f.main.matchAll(/<section class="shelf(?: active-shelf)?\s*" data-shelf="([^"]+)"/g)].map(match=>match[1]),searchEditing:/class="search-hud"/.test(f.main)};
   if(step.action==='command')actual.effects=[...f.commands.slice(commandsBefore).map(value=>value.action),...(f.overlay?[/id="markup-canvas"/.test(f.overlay)?'markup':'preview']:[])];
   const reported=copied||actual;observations.push({scenarioId:scenario.id,step:index,actual:reported});
   try{assert.deepEqual(reported,step.expect);}catch(error){errors.push(scenario.id+' step '+index+': '+error.message);}
  }
 }}finally{for(const directory of directories)fs.rmSync(directory,{recursive:true,force:true});}
 if(process.env.CLIPBOARDLINE_PARITY_REPORT){
  const revision=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim();
  const implementationSHA256=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../renderer.js'))).digest('hex');
  const report={schemaVersion:1,contractId:contract.contractId,platform:'windows',hostPlatform:process.platform,mode:'renderer',sourceRevision:revision,contractSHA256:crypto.createHash('sha256').update(raw).digest('hex'),implementationSHA256,implementationFiles:{'windows/renderer.js':implementationSHA256},observations,passed:errors.length===0,errors};
  fs.mkdirSync(path.dirname(path.resolve(process.env.CLIPBOARDLINE_PARITY_REPORT)),{recursive:true});fs.writeFileSync(process.env.CLIPBOARDLINE_PARITY_REPORT,JSON.stringify(report,null,2)+'\n');
 }
 assert.deepEqual(errors,[]);
});

test('folder menu arrows retain folder operations and Enter creates a subfolder under the chosen folder',async()=>{
 const f=fixture();await f.ready();const folderId='10000000-0000-4000-8000-000000000000';
 f.api.emit({folders:[{id:folderId,name:'Chosen folder',parentId:null}]});
 await f.api.command('library');await f.click('folder-menu',{folder:folderId});
 assert.match(f.overlay,/Rename folder/);assert.match(f.overlay,/New subfolder/);assert.match(f.overlay,/Remove folder/);
 await f.key('ArrowDown');
 assert.match(f.overlay,/dialog-option selected[^>]*data-action="new-subfolder"/);
 assert.doesNotMatch(f.overlay,/Search actions|execute-command/);
 await f.key('Enter');assert.match(f.overlay,/New folder/);
 await f.input('simple-input','Child folder');await f.key('Enter');
 assert.equal(f.commands.at(-1).action,'createFolder');
 assert.deepEqual(f.commands.at(-1).payload,{name:'Child folder',parentId:folderId});
 assert.equal(f.commands.filter(command=>['copy','paste','pin','remove'].includes(command.action)).length,0);
});

test('folder menu Enter renames its folder and Escape cancels remaining folder actions',async()=>{
 const f=fixture();await f.ready();const folderId='10000000-0000-4000-8000-000000000000';
 f.api.emit({folders:[{id:folderId,name:'Chosen folder',parentId:null}]});
 await f.api.command('library');await f.click('folder-menu',{folder:folderId});
 await f.key('Enter');assert.match(f.overlay,/Rename folder/);
 await f.input('simple-input','Renamed folder');await f.key('Enter');
 assert.equal(f.commands.at(-1).action,'renameFolder');
 assert.deepEqual(f.commands.at(-1).payload,{id:folderId,name:'Renamed folder'});
 await f.click('folder-menu',{folder:folderId});await f.key('ArrowDown');
 const commands=f.commands.length;await f.key('Escape');
 assert.equal(f.overlay,'');assert.equal(f.commands.length,commands);
});

test('folder menu removal requires its confirmation and never removes an item instead',async()=>{
 const f=fixture();await f.ready();const folderId='10000000-0000-4000-8000-000000000000';
 f.api.emit({folders:[{id:folderId,name:'Chosen folder',parentId:null}]});
 await f.api.command('library');await f.click('folder-menu',{folder:folderId});
 await f.key('ArrowDown');await f.key('ArrowDown');
 assert.match(f.overlay,/dialog-option selected[^>]*data-action="remove-folder"/);
 await f.key('Enter');assert.match(f.overlay,/Item content remains in the library/);
 assert.equal(f.commands.filter(command=>command.action==='removeFolder').length,0);
 await f.key('Enter');assert.equal(f.commands.at(-1).action,'removeFolder');
 assert.deepEqual(f.commands.at(-1).payload,{id:folderId});
 assert.equal(f.commands.filter(command=>['copy','paste','pin','remove','trash'].includes(command.action)).length,0);
});


test('late initial hidden state cannot replace a newer visible global search',async()=>{
 const f=fixture({deferInitialState:true,initialVisible:false});
 f.api.emit({windowVisible:true,viewEvent:{serial:'initial-global-search',search:true}});await f.ready();
 assert.match(f.main,/id="search-input"/);assert.deepEqual(selectedCards(f),[f.image]);
 f.releaseInitialState();await f.ready();
 assert.match(f.main,/id="search-input"/);assert.deepEqual(selectedCards(f),[f.image]);
});


test('custom shortcut overrides win over newly introduced defaults and hints show only the winning binding',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('ArrowRight');
 f.api.emit({settings:{...f.state.settings,localShortcuts:{previous:'P'}}});await f.ready();
 await f.key('KeyP');assert.equal(focusedCard(f),f.text1);assert.equal(f.state.items.find(value=>value.id===f.text1).pinned,false);
 await f.key('KeyK',{ctrl:true});
 assert.match(f.overlay,/data-command="previous"[\s\S]*?<kbd>P<\/kbd>/);
 const pinRow=f.overlay.match(/<button[^>]*data-command="pin"[\s\S]*?<\/button>/)?.[0];assert.ok(pinRow);assert.doesNotMatch(pinRow,/<kbd>P(?: |<)/);assert.match(pinRow,/<kbd>Ctrl\+P<\/kbd>/);
 await f.key('Escape');await f.key('KeyP',{ctrl:true});assert.equal(f.state.items.find(value=>value.id===f.text1).pinned,true);
});

test('disabling or remapping copy, aliases, quick slots and range extension does not leave hardcoded keys active',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');
 f.api.emit({settings:{...f.state.settings,localShortcuts:{copy:'',pin:'',select2:'Q',extendNext:'Shift+J'}}});await f.ready();
 const before=f.commands.length;
 for(const [code,modifiers]of [['Enter',{}],['KeyC',{ctrl:true}],['KeyP',{}],['KeyP',{ctrl:true}]])await f.key(code,modifiers);
 assert.equal(f.commands.length,before);assert.equal(f.state.windowVisible,true);
 await f.key('KeyQ');assert.equal(focusedCard(f),f.text2);
 await f.key('ArrowLeft');await f.key('ArrowRight',{shift:true});assert.deepEqual(selectedCards(f),[f.text1],'Old Shift+Right binding is disabled after remapping');
 await f.key('KeyJ',{shift:true});assert.deepEqual(selectedCards(f),[f.text1,f.text2]);
 await f.key('ArrowLeft');await f.key('Digit2');assert.equal(focusedCard(f),f.text1,'Old number binding is disabled after remapping');
});

test('Library Backspace restores Library Trash when shelf undo has a custom binding',async()=>{
 const f=fixture();await f.ready();await f.key('KeyP');await f.key('KeyL');
 f.api.emit({settings:{...f.state.settings,localShortcuts:{undo:'U'}}});await f.ready();
 await f.key('KeyS');assert.ok(f.state.items.find(value=>value.id===f.image).trashedAt);await f.key('Backspace');assert.equal(f.state.items.find(value=>value.id===f.image).trashedAt,null);assert.equal(f.commands.filter(value=>value.action==='undo').length,0);assert.equal(f.commands.filter(value=>value.action==='undoTrash').length,1);
});

test('shortcut recorder rejects overlapping conflicts but allows a key owned by markup in a different context',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();await f.click('record-local',{keyAction:'pin'});
 await f.key('KeyS');await f.click('confirm-modal');assert.match(f.overlay,/Record shortcut/);assert.match(f.nodes.get('toast').textContent,/already used for Move to Trash/);
 assert.equal(f.state.settings.localShortcuts.pin,undefined);
 await f.key('KeyO');await f.click('confirm-modal');assert.equal(f.overlay,'');assert.equal(f.state.settings.localShortcuts.pin,'O');
 await f.api.command('show');await f.ready();await f.key('KeyO');assert.equal(f.state.items.find(value=>value.id===f.image).pinned,true);
 await f.key('Space');await f.key('KeyM');await f.key('KeyO');assert.match(f.overlay,/data-tool="ellipse" aria-pressed="true"/);
 await f.click('save-image');await f.api.command('settings');await f.click('reset-local-shortcuts');assert.deepEqual(f.state.settings.localShortcuts,{});
 await f.api.command('show');await f.key('KeyP',{ctrl:true});assert.equal(f.state.items.find(value=>value.id===f.image).pinned,false,'Reset restores the Ctrl+P alias');
});

test('remapped Actions works in native search but disabled Actions leaves editor typing alone',async()=>{
 const f=fixture();await f.ready();f.api.emit({settings:{...f.state.settings,localShortcuts:{actions:'Ctrl+J'}}});await f.ready();
 await f.key('KeyS',{shift:true});const editor=f.nodes.get('search-input');editor.matches=selector=>selector.includes('input');
 assert.equal((await f.key('KeyK',{ctrl:true,target:editor})).prevented,undefined);assert.equal(f.overlay,'');
 await f.key('KeyJ',{ctrl:true,target:editor});assert.match(f.overlay,/Search actions/);
 await f.key('Escape');f.api.emit({settings:{...f.state.settings,localShortcuts:{actions:''}}});await f.ready();
 assert.equal((await f.key('KeyK',{ctrl:true,target:editor})).prevented,undefined);assert.equal(f.overlay,'');
});

test('CtrlEnter finishes text and image editing without accidentally pasting; native field CtrlC is not intercepted',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('Space');await f.key('KeyE');
 await f.input('text-editor','A retained edit');const editor=f.nodes.get('text-editor');editor.matches=selector=>selector.includes('textarea');
 assert.equal((await f.key('KeyC',{ctrl:true,target:editor})).prevented,undefined);
 await f.key('Enter',{ctrl:true,target:editor});assert.doesNotMatch(f.overlay,/id="text-editor"/);assert.equal(f.state.items.find(value=>value.id===f.text1).text,'A retained edit');
 assert.equal(f.commands.filter(value=>value.action==='paste').length,0);await f.key('ArrowUp');await f.key('KeyM');
 await f.key('Enter',{ctrl:true});assert.doesNotMatch(f.overlay,/id="markup-canvas"/);assert.match(f.overlay,/id="preview-dialog"/);assert.equal(f.commands.filter(value=>value.action==='paste').length,0);
 await f.key('Enter',{ctrl:true});assert.equal(f.commands.at(-1).action,'paste');assert.deepEqual(f.commands.at(-1).payload.ids,[f.image]);
});

test('text Finish editing can be remapped separately from paste and never consumes ordinary typing',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('Space');await f.key('KeyE');
 f.api.emit({settings:{...f.state.settings,localShortcuts:{finishEditing:'Ctrl+D'}}});await f.ready();
 await f.input('text-editor','Remapped edit');const editor=f.nodes.get('text-editor');editor.matches=selector=>selector.includes('textarea');
 await f.key('Enter',{ctrl:true,target:editor});assert.match(f.overlay,/id="text-editor"/);assert.equal(f.commands.filter(value=>value.action==='paste').length,0);
 await f.key('KeyD',{ctrl:true,target:editor});assert.doesNotMatch(f.overlay,/id="text-editor"/);assert.equal(f.state.items.find(value=>value.id===f.text1).text,'Remapped edit');
});

test('action bar snapshots the focused member of a batch for Preview and keeps ordered IDs for batch naming',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('ArrowRight',{shift:true});
 assert.equal(focusedCard(f),f.text2);assert.deepEqual(selectedCards(f),[f.text1,f.text2]);
 await f.key('KeyK',{ctrl:true});await f.input('modal-query','Preview');await f.key('Enter');assert.match(f.overlay,/aria-label="Text two"/);
 await f.key('Escape');await f.key('KeyK',{ctrl:true});await f.input('modal-query','Name and pin');await f.key('Enter');assert.match(f.overlay,/1 \/ 2/);await f.input('name-input','First batched note');await f.key('Enter');
 assert.equal(f.state.items.find(value=>value.id===f.text1).name,'First batched note');assert.match(f.overlay,/2 \/ 2/);
});

test('action bar exposes real navigation, image tools, Library views and Settings destinations without synthetic key presses',async()=>{
 const f=fixture();await f.ready();await f.key('KeyK',{ctrl:true});await f.input('modal-query','Marker');await f.key('Enter');assert.match(f.overlay,/id="markup-canvas"/);assert.match(f.overlay,/data-tool="marker" aria-pressed="true"/);
 await f.key('Enter',{ctrl:true});await f.key('KeyK',{ctrl:true});await f.input('modal-query','Next item');assert.match(f.overlay,/data-command="next"/);await f.key('Escape');await f.key('Escape');
 await f.key('KeyP');await f.key('KeyL');await f.key('KeyK',{ctrl:true});await f.input('modal-query','List view');await f.key('Enter');assert.match(f.main,/library-grid list/);
 await f.key('KeyK',{ctrl:true});await f.input('modal-query','Settings · History');await f.key('Enter');assert.match(f.main,/data-retention="text"/);assert.match(f.main,/data-retention="link"/);
});

test('action bar content search follows Library scope and disabled image commands cannot run on text',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('KeyP');await f.key('KeyL');
 await f.key('KeyK',{ctrl:true});await f.input('modal-query','Search contents');await f.key('Enter');assert.equal(f.state.view,'library');assert.doesNotMatch(f.main,/search-hud/);
 await f.key('KeyK',{ctrl:true});await f.input('modal-query','Crop image');assert.match(f.overlay,/data-command="crop" disabled/);const before=f.commands.length;await f.key('Enter');assert.equal(f.commands.length,before);assert.doesNotMatch(f.overlay,/markup-canvas/);assert.match(f.overlay,/Search actions/);
});

test('crop Escape cancels direct crop to browsing while markup crop apply returns to the markup workspace',async()=>{
 const f=fixture();await f.ready();await f.key('Space');await f.key('KeyC');await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);
 await f.key('Escape');assert.doesNotMatch(f.overlay,/markup-canvas/);assert.match(f.overlay,/preview-dialog/);assert.equal(f.commands.filter(value=>value.action==='saveImage').length,0);
 await f.key('KeyM');await f.key('KeyC');await f.pointer('pointerdown',60,30);await f.pointer('pointermove',500,150);await f.pointer('pointerup',500,150);await f.key('Enter');
 assert.match(f.overlay,/markup-canvas/);assert.match(f.overlay,/data-tool="select" aria-pressed="true"/);assert.deepEqual(f.state.items.find(value=>value.id===f.image).crop,{x:60,y:30,width:440,height:120});
});

test('Settings records and directly disables optional global Library and copy-latest-image shortcuts',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();await f.click('settings-tab',{tab:'shortcuts'});
 assert.match(f.main,/data-action="record-global" data-key-action="library"/);assert.match(f.main,/data-action="record-global" data-key-action="copyLatest"/);
 await f.click('record-global',{keyAction:'library'});await f.key('KeyL');await f.click('confirm-modal');assert.match(f.overlay,/Record shortcut/);assert.match(f.nodes.get('toast').textContent,/Use Control or Alt/);
 await f.key('KeyL',{ctrl:true,alt:true});await f.click('confirm-modal');assert.equal(f.commands.filter(value=>value.action==='setSettings').at(-1).payload.patch.shortcuts.library,'Control+Alt+L');
 await f.click('record-global',{keyAction:'copyLatest'});await f.key('KeyC',{ctrl:true,alt:true});await f.click('confirm-modal');assert.equal(f.commands.filter(value=>value.action==='setSettings').at(-1).payload.patch.shortcuts.copyLatest,'Control+Alt+C');
 await f.click('disable-global',{keyAction:'copyLatest'});assert.equal(f.commands.filter(value=>value.action==='setSettings').at(-1).payload.patch.shortcuts.copyLatest,'');
});

for(const [width,height]of[[3840,2160],[7680,4320]])test('retained '+width+'×'+height+' markup coalesces pointer painting without dropping samples or copying the original',async()=>{
 const f=fixture({queuedAnimationFrames:true,imageRaster:{width,height}});await f.ready();await f.key('Space');f.flushAnimationFrames();await f.key('KeyM');f.flushAnimationFrames();await f.click('image-tool',{tool:'pen'});f.flushAnimationFrames();f.paintCalls.length=0;
 await f.pointer('pointerdown',90,44);for(let index=1;index<=96;index++)await f.pointer('pointermove',90+index*6,44+index);await f.pointer('pointerup',666,140);
 assert.equal(f.animationFrames.length,1);assert.equal(f.paintCalls.filter(value=>value.canvas==='markup-canvas').length,0,'No synchronous per-event raster work');f.flushAnimationFrames();
 assert.equal(f.paintCalls.filter(value=>value.canvas==='markup-canvas'&&value.operation==='clearRect').length,1);assert.equal(f.paintCalls.filter(value=>value.canvas==='markup-canvas'&&value.operation==='drawImage').length,0);assert.equal(f.imageLoads.length,1);
 await f.key('KeyS',{ctrl:true});const saved=f.commands.find(value=>value.action==='saveImage');assert.ok(saved);assert.equal(saved.payload.annotations[0].points.length,97);assert.deepEqual(saved.payload.annotations[0].points[0],{x:width*.1,y:height*.2});assert.ok(Math.abs(saved.payload.annotations[0].points.at(-1).x-width*666/900)<1e-7);
});
test('Turkish Settings toggles use the same localized visible and accessible label',async()=>{const f=fixture();await f.ready();await f.api.command('settings');await f.api.emit({settings:{...f.state.settings,language:'tr'}});await f.ready();assert.match(f.main,/aria-label="Sesler"/);assert.doesNotMatch(f.main,/aria-label="Sounds"/);});

test('closing an editor before its scheduled frame prevents stale overlay painting',async()=>{const f=fixture({queuedAnimationFrames:true});await f.ready();await f.key('Space');f.flushAnimationFrames();await f.key('KeyM');assert.equal(f.animationFrames.length,1);await f.key('Escape');assert.doesNotMatch(f.overlay,/id="markup-canvas"/);f.paintCalls.length=0;f.flushAnimationFrames();assert.equal(f.paintCalls.filter(value=>value.canvas==='markup-canvas').length,0);assert.match(f.overlay,/id="preview-dialog"/);});

async function historyCleanupFixture(language='en'){
 const f=fixture();await f.ready();const basedOn=(kind,id,extra)=>({...structuredClone(f.state.items.find(value=>value.kind===kind)),id,retainedAt:null,pinned:false,folderIds:[],tags:[],trashedAt:null,...extra});
 f.api.emit({settings:{...f.state.settings,language},items:[...f.state.items.map(value=>value.id===f.text2?{...value,retainedAt:1000}:value),
  basedOn('image','00000000-0000-4000-8000-000000000005',{pinned:true}),basedOn('link','00000000-0000-4000-8000-000000000006',{folderIds:['retained-folder']}),
  basedOn('text','00000000-0000-4000-8000-000000000007',{tags:['retained-tag']}),basedOn('link','00000000-0000-4000-8000-000000000008',{trashedAt:1000})]});
 await f.api.command('settings');await f.click('settings-tab',{tab:'history'});return f;
}
test('History cleanup selector counts each actual unsaved type and excludes saved organization and old Trash',async()=>{
 const f=await historyCleanupFixture();assert.match(f.main,/id="history-cleanup-kind" aria-label="Copies to clear"/);assert.match(f.main,/data-history-cleanup-count role="status">3 unsaved copies/);
 for(const kind of['image','text','link']){await f.change('history-cleanup-kind',kind);assert.match(f.main,new RegExp('value="'+kind+'" selected'));assert.match(f.main,/data-history-cleanup-count role="status">1 unsaved copies/);}
 f.api.emit({items:f.state.items.map(value=>value.id===f.link?{...value,retainedAt:2000}:value)});await f.ready();assert.match(f.main,/data-history-cleanup-count role="status">0 unsaved copies/);assert.match(f.main,/data-action="clear-history"[^>]*disabled/);
});
for(const cancel of['Escape','button'])test('History cleanup '+cancel+' cancel sends no backend operation and changes no records',async()=>{
 const f=await historyCleanupFixture(),before=structuredClone(f.state),calls=f.commands.length;await f.click('clear-history');assert.match(f.overlay,/aria-label="Clear unsaved copies\?"/);assert.match(f.overlay,/3 unsaved copies will move/);
 if(cancel==='Escape')await f.key('Escape');else await f.click('close-modal');assert.equal(f.overlay,'');assert.equal(f.commands.length,calls);assert.deepEqual(f.state,before);
});
test('History cleanup confirmation keeps the chosen kind and captured IDs when later copies arrive or an item is newly saved',async()=>{
 const f=await historyCleanupFixture();await f.change('history-cleanup-kind','text');await f.click('clear-history');assert.match(f.overlay,/1 unsaved copies will move/);const later='00000000-0000-4000-8000-000000000009';
 f.api.emit({items:[...f.state.items.map(value=>value.id===f.text1?{...value,retainedAt:3000}:value),{...structuredClone(f.state.items.find(value=>value.id===f.text1)),id:later,retainedAt:null,text:'Copied after confirmation opened'}]});await f.ready();await f.key('Enter');
 const commands=f.commands.filter(value=>value.action==='clearUnsavedHistory');assert.equal(commands.length,1);assert.deepEqual(commands[0].payload,{kind:'text',ids:[f.text1],captures:{[f.text1]:{revision:null,createdAt:900,updatedAt:900,lastCopiedAt:null}}});assert.equal(commands[0].payload.ids.includes(later),false);assert.equal(f.overlay,'');
});
test('Turkish History cleanup uses the same localized visible selector label, accessible label, count, action and confirmation',async()=>{
 const f=await historyCleanupFixture('tr');assert.match(f.main,/<strong>Temizlenecek kopyalar<\/strong>/);assert.match(f.main,/id="history-cleanup-kind" aria-label="Temizlenecek kopyalar"/);assert.match(f.main,/3 kaydedilmemiş kopya/);assert.match(f.main,/Kaydedilmemiş kopyaları temizle…/);
 await f.change('history-cleanup-kind','text');await f.click('clear-history');assert.match(f.overlay,/aria-label="Kaydedilmemiş kopyalar temizlensin mi\?"/);assert.match(f.overlay,/1 kaydedilmemiş kopya, Kütüphane/);assert.match(f.overlay,/>Çöp Kutusu(?:’|'|&#39;)na taşı</);assert.match(f.overlay,/>İptal</);
});

test('all recorder exits end their suspension and replacement recorder tokens remain distinct',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();
 await f.click('record-global',{keyAction:'search'});const first=f.commands.find(value=>value.action==='beginShortcutRecording').payload.token;assert.match(f.overlay,/data-recording-ready="true"/);
 await f.key('KeyS',{ctrl:true,alt:true});assert.match(f.overlay,/Ctrl\+Alt\+S/);assert.equal(f.state.view,'settings');await f.key('Escape');assert.equal(f.overlay,'');assert.ok(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===first));
 await f.click('record-local',{keyAction:'pin'});const second=f.commands.filter(value=>value.action==='beginShortcutRecording').at(-1).payload.token;assert.notEqual(first,second);await f.blur();assert.equal(f.overlay,'');assert.ok(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===second));
 await f.click('record-global',{keyAction:'library'});await f.click('record-local',{keyAction:'name'});const starts=f.commands.filter(value=>value.action==='beginShortcutRecording');assert.equal(starts.length,4);assert.ok(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===starts[2].payload.token));assert.ok(f.commands.findIndex(value=>value.action==='beginShortcutRecording'&&value.payload.token===starts[3].payload.token)<f.commands.findIndex(value=>value.action==='endShortcutRecording'&&value.payload.token===starts[2].payload.token));await f.click('close-modal');assert.equal(f.overlay,'');assert.ok(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===starts[3].payload.token));
});

test('History confirmation preserves the original capture stamp when the same item ID is recopied or edited while it is open',async()=>{
 const f=await historyCleanupFixture(),before='11111111-1111-4111-8111-111111111111',after='22222222-2222-4222-8222-222222222222';f.api.emit({items:f.state.items.map(value=>value.id===f.text1?{...value,captureRevision:before}:value)});await f.ready();await f.change('history-cleanup-kind','text');await f.click('clear-history');
 f.api.emit({items:f.state.items.map(value=>value.id===f.text1?{...value,captureRevision:after,createdAt:4000,updatedAt:5000}:value)});await f.ready();await f.key('Enter');const request=f.commands.find(value=>value.action==='clearUnsavedHistory');assert.ok(request);assert.deepEqual(request.payload,{kind:'text',ids:[f.text1],captures:{[f.text1]:{revision:before,createdAt:900,updatedAt:900,lastCopiedAt:null}}});
});

test('Escape while recorder startup is pending releases its token even after a late reply',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();const release=f.deferReply('beginShortcutRecording');
 await f.click('record-global',{keyAction:'search'});assert.match(f.overlay,/data-recording-ready="false"/);const token=f.commands.filter(value=>value.action==='beginShortcutRecording').at(-1).payload.token;
 await f.key('Escape');assert.equal(f.overlay,'');assert.ok(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===token));release();await f.ready();assert.equal(f.overlay,'');
});

for(const row of [
 {code:'',key:'s',expected:'Ctrl+Alt+S',saved:'Control+Alt+S'},
 {code:'Unidentified',key:'s',expected:'Ctrl+Alt+S',saved:'Control+Alt+S'},
 {code:'',key:'s',shift:true,expected:'Ctrl+Alt+Shift+S',saved:'Control+Alt+Shift+S'},
 {code:'Unidentified',key:'S',shift:true,expected:'Ctrl+Alt+Shift+S',saved:'Control+Alt+Shift+S'},
 {code:'KeyS',key:'s',expected:'Ctrl+Alt+S',saved:'Control+Alt+S'},
 {code:'KeyQ',key:'x',expected:'Ctrl+Alt+Q',saved:'Control+Alt+Q'},
 {code:'Unidentified',key:'ı',expected:'Ctrl+Alt+ı',saved:'Control+Alt+ı'}
])test('recorder canonicalizes ASCII fallback without changing modifiers or hardware keys: '+JSON.stringify(row),async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();await f.click('record-global',{keyAction:'search'});
 await f.key(row.code,{key:row.key,ctrl:true,alt:true,shift:!!row.shift});
 assert.ok(f.overlay.includes('>'+row.expected+'</div>'),f.overlay);
 await f.click('confirm-modal');assert.equal(f.overlay,'');assert.equal(f.commands.filter(value=>value.action==='setSettings').at(-1).payload.patch.shortcuts.search,row.saved);
});

test('unknown-code key events execute default shortcuts with the same letter and Shift meanings',async()=>{
 const f=fixture();await f.ready();await f.key('',{key:'p'});assert.equal(f.state.items.find(value=>value.id===f.image).pinned,true);
 await f.key('Unidentified',{key:'p'});assert.equal(f.state.items.find(value=>value.id===f.image).pinned,false);
 await f.key('Unidentified',{key:'p',shift:true});assert.match(f.overlay,/Pin to folder/);await f.key('Escape');
 await f.key('',{key:'l'});assert.equal(f.state.view,'library');
});

test('legacy lowercase remaps compare canonically without reviving disabled defaults or aliases',async()=>{
 const f=fixture();await f.ready();f.api.emit({settings:{...f.state.settings,localShortcuts:{pin:'Ctrl+Alt+j',library:'l',copy:'',remove:''}}});await f.ready();
 await f.key('KeyJ',{ctrl:true,alt:true});assert.equal(f.state.items.find(value=>value.id===f.image).pinned,true);
 await f.key('Unidentified',{key:'j',ctrl:true,alt:true});assert.equal(f.state.items.find(value=>value.id===f.image).pinned,false);
 const before=f.commands.length;await f.key('',{key:'p'});await f.key('KeyP',{ctrl:true});await f.key('Unidentified',{key:'s'});await f.key('Enter');await f.key('',{key:'c',ctrl:true});
 assert.equal(f.commands.length,before);assert.equal(f.state.windowVisible,true);
 await f.key('KeyL');assert.equal(f.state.view,'library');assert.equal(f.state.settings.localShortcuts.pin,'Ctrl+Alt+j','Reading a binding does not rewrite saved preferences');
});

test('recording a fallback letter detects a conflicting legacy lowercase remap',async()=>{
 const f=fixture();await f.ready();f.api.emit({settings:{...f.state.settings,localShortcuts:{remove:'j'}}});await f.ready();await f.api.command('settings');await f.ready();
 await f.click('record-local',{keyAction:'pin'});await f.key('Unidentified',{key:'j'});await f.click('confirm-modal');
 assert.match(f.overlay,/Record shortcut/);assert.match(f.nodes.get('toast').textContent,/already used for Take down/);assert.equal(f.state.settings.localShortcuts.pin,undefined);
 await f.key('Escape');
});
test('recording a key that a preview uses for another action is a conflict like macOS',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();
 await f.click('record-local',{keyAction:'remove'});await f.key('KeyO',{ctrl:true});await f.click('confirm-modal');
 assert.match(f.overlay,/Record shortcut/);assert.match(f.nodes.get('toast').textContent,/already used for Open in browser/);assert.equal(f.state.settings.localShortcuts.remove,undefined);
 await f.key('Escape');
});

test('recording the same legacy lowercase global binding keeps its exact registration value',async()=>{
 const f=fixture();await f.ready();f.api.emit({settings:{...f.state.settings,shortcuts:{...f.state.settings.shortcuts,search:'Control+Alt+s'}}});await f.ready();await f.api.command('settings');await f.ready();
 await f.click('record-global',{keyAction:'search'});await f.key('Unidentified',{key:'s',ctrl:true,alt:true});assert.ok(f.overlay.includes('>Ctrl+Alt+S</div>'));await f.click('confirm-modal');
 assert.equal(f.commands.filter(value=>value.action==='setSettings').at(-1).payload.patch.shortcuts.search,'Control+Alt+s','An equal OS combination does not undergo a conflicting case-only re-registration');
});

async function keyboardSaved(f){f.api.emit({items:f.state.items.map(value=>({...value,pinned:true}))});await f.ready();await f.key('KeyL');}
test('Library first opening selects content and valid selection survives reentry and returning from shelves',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);assert.equal(focusedCard(f),f.image);await f.key('ArrowRight');assert.equal(focusedCard(f),f.text1);
 await f.api.command('hide');await f.api.command('library');await f.ready();assert.equal(focusedCard(f),f.text1);await f.api.command('show');await f.api.command('library');await f.ready();assert.equal(focusedCard(f),f.text1);assert.equal(selectedCards(f).length,1);
});
test('Library S Delete and ControlBackspace use recoverable Trash; Backspace and ControlZ restore and keep the window',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);
 for(const [remove,mods,undo,undoMods]of [['KeyS',{},'Backspace',{}],['Delete',{},'KeyZ',{ctrl:true}],['Backspace',{ctrl:true},'Backspace',{}]]){await f.key(remove,mods);assert.equal(f.overlay,'');assert.ok(f.state.items.find(value=>value.id===f.image).trashedAt);assert.equal(focusedCard(f),f.text1);await f.key(undo,undoMods);assert.equal(f.state.items.find(value=>value.id===f.image).trashedAt,null);assert.equal(focusedCard(f),f.image);}
 assert.equal(f.commands.filter(value=>value.action==='delete').length,0);assert.equal(f.state.windowVisible,true);
});
test('Library Trash and pane navigation respect disabled bindings and remapped aliases',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);f.api.emit({settings:{...f.state.settings,localShortcuts:{remove:'Y',trash:'X',undoTrash:'U',focusNextPane:'',focusPreviousPane:''}}});await f.ready();const before=f.commands.length;
 for(const [key,extra]of [['KeyS',{}],['Delete',{}],['Backspace',{}],['KeyZ',{ctrl:true}],['F6',{}],['Tab',{ctrl:true}],['F6',{shift:true}],['Tab',{ctrl:true,shift:true}]])assert.equal((await f.key(key,extra)).prevented,undefined,key+' must not trigger a disabled binding');
 assert.equal(f.commands.length,before);await f.key('KeyX');assert.ok(f.state.items.find(value=>value.id===f.image).trashedAt);await f.key('KeyU');assert.equal(f.state.items.find(value=>value.id===f.image).trashedAt,null);
});
test('Library E M and C open the selected content editor without a pointer action',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);await f.key('ArrowRight');await f.key('KeyE');assert.match(f.overlay,/id="text-editor"/);await f.key('Escape');await f.key('Escape');await f.key('ArrowLeft');await f.key('KeyC');assert.match(f.overlay,/id="markup-canvas"/);assert.match(f.overlay,/Apply crop/);await f.key('Escape');await f.key('Escape');await f.key('KeyM');assert.match(f.overlay,/id="markup-canvas"/);assert.match(f.overlay,/Done/);
});
test('Library focused buttons retain native Enter Space activation instead of selected-item copy or preview',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);const button=f.nodes.get('app');button.closest=selector=>selector==='button'?button:null;button.tagName='BUTTON';const before=f.commands.length;
 for(const key of ['Enter','Space'])assert.equal((await f.key(key,{target:button})).prevented,undefined,'The native button activation default is preserved');assert.equal(f.commands.length,before);assert.equal(f.overlay,'');
});
test('Library ControlF works inside an editor; caret arrows stay native and Escape keeps the query',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);await f.key('KeyF',{ctrl:true});const field=f.nodes.get('search-input');field.tagName='INPUT';field.matches=selector=>selector.includes('input');assert.equal((await f.key('KeyF',{ctrl:true,target:field})).prevented,true);await f.input('search-input','Text one');assert.equal((await f.key('ArrowLeft',{target:field})).prevented,undefined);assert.equal((await f.key('Escape',{target:field})).prevented,true);assert.match(f.main,/value="Text one"/);assert.equal(focusedCard(f),f.text1);
});

test('shared Library keyboard contract runs actual renderer handlers and durable Store transactions',async()=>{
 const os=require('node:os'),{Store}=require('../lib/model.cjs');
 const contractFile=path.resolve(__dirname,'../../contracts/library-keyboard.json'),raw=fs.readFileSync(contractFile),contract=JSON.parse(raw),observations=[],errors=[];
 assert.equal(contract.contractId,'clipboardline.library.keyboard.v1');
 for(const scenario of contract.scenarios){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-library-contract-'));
  try{
   const store=new Store(directory),now=Date.now(),f=fixture(),aliases=new Map(),ids=new Map();await f.ready();f.grid(scenario.columns);
   store.data.items=contract.records.map((entry,index)=>{const id='30000000-0000-4000-8000-'+String(index+1).padStart(12,'0');aliases.set(id,entry.id);ids.set(entry.id,id);const source=f.state.items.find(value=>value.kind===entry.kind);return{...structuredClone(source),id,createdAt:now-index*1000,updatedAt:now-index*1000,retainedAt:now,pinned:entry.pinned,hiddenFromShelf:!entry.onShelf,name:entry.title,title:entry.kind==='link'?entry.title:'',text:entry.kind==='text'?entry.text:'',url:entry.kind==='link'?'https://example.com/library-contract/'+entry.id:'',captureRevision:crypto.randomUUID(),...(entry.kind==='image'?{imageFile:'0'.repeat(64)+'.png'}:{})};});
   store.persist();let surface={view:'shelves',windowVisible:false,version:'1.7.7'};
   f.api.command=async(action,payload={})=>{f.commands.push({action,payload:structuredClone(payload)});let result;if(['library','show','settings'].includes(action))surface={...surface,view:action==='show'?'shelves':action,windowVisible:true};else if(action==='hide')surface.windowVisible=false;else if(action==='searchImages')result={ids:[],scores:[],available:false,indexing:false};else result=store.modify(action,payload);const next={...store.publicState(),...surface,result};f.api.emit(next);return structuredClone(next);};
   f.api.emit({...store.publicState(),...surface});await f.ready();
   for(let index=0;index<scenario.steps.length;index++){
    const step=scenario.steps[index];
    if(step.action==='open')await f.api.command('library');
    else if(step.action==='close')await f.api.command('hide');
    else if(step.action==='mode')await f.click('view-mode');
    else if(step.action==='select'){await f.key('ArrowLeft',{ctrl:true});const target=contract.records.findIndex(value=>value.id===step.id);for(let n=0;n<target;n++)await f.key('ArrowRight');}
    else if(step.action==='scope'){await f.click('scope',{scope:step.scope});await f.key('Enter',{target:f.editor('search-input')});}
    else if(step.action==='searchHandoff'){const editor=f.editor('search-input');await f.input('search-input',step.value);await f.key('Enter',{target:editor});}
    else if(step.action==='remap'){const value=step.key?.startsWith('Key')?step.key.slice(3):step.key;await f.api.command('setSettings',{patch:{localShortcuts:{[step.binding]:value}}});}
    else if(step.action==='key')await f.key(step.code,{ctrl:step.modifiers.some(value=>['primary','control'].includes(value)),alt:step.modifiers.includes('alt'),shift:step.modifiers.includes('shift'),...(step.editing?{target:f.editor('detail-text')}:{})});
    else throw new Error('Unknown Library contract action '+step.action);
    await f.ready();const actual={focused:aliases.get(focusedCard(f))||null,selected:selectedCards(f).map(id=>aliases.get(id)),visible:[...f.main.matchAll(/<article class="[^"]*"[^>]*data-item-id="([^"]+)"/g)].map(value=>aliases.get(value[1])),scope:f.main.match(/data-action="scope" data-scope="([^"]+)" class="active"/)?.[1]||'saved',kind:f.main.match(/data-action="(allTypes|images|texts|links)" aria-pressed="true"/)?.[1]||'allTypes',search:f.nodes.get('search-input')?.value||'',list:/class="library-grid list"/.test(f.main),trashed:contract.records.filter(value=>store.item(ids.get(value.id)).trashedAt).map(value=>value.id),pinned:contract.records.filter(value=>store.item(ids.get(value.id)).pinned).map(value=>value.id),pinnedOnly:/data-action="pinnedOnly"[^>]*aria-pressed="true"/.test(f.main)};
    actual.kind={allTypes:'all',images:'image',texts:'text',links:'link'}[actual.kind];
    // The DOM fixture stores input values only after input/focus events; the
    // rendered field remains the source of truth after a keyboard filter.
    actual.search=(f.main.match(/id="search-input"[^>]*value="([^"]*)"/)?.[1]||'').replaceAll('&quot;','"').replaceAll('&amp;','&');
    const expected={...step.expect,visible:contract.views[step.expect.visible]};observations.push({scenarioId:scenario.id,step:index,actual});try{assert.deepEqual(actual,expected);}catch(error){errors.push(scenario.id+' step '+index+': '+error.message);}
   }
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 const libraryReportDestination=process.env.CLIPBOARDLINE_LIBRARY_KEYBOARD_REPORT || (process.env.CLIPBOARDLINE_PARITY_REPORT && path.join(path.dirname(process.env.CLIPBOARDLINE_PARITY_REPORT),'library-windows.json'));
 if(libraryReportDestination){const revision=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim(),report={schemaVersion:1,contractId:contract.contractId,contractSHA256:crypto.createHash('sha256').update(raw).digest('hex'),platform:'windows',hostPlatform:process.platform,mode:'renderer',sourceRevision:revision,observations,errors,passed:errors.length===0};fs.mkdirSync(path.dirname(path.resolve(libraryReportDestination)),{recursive:true});fs.writeFileSync(libraryReportDestination,JSON.stringify(report,null,2)+'\n');}
 assert.deepEqual(errors,[]);
});


test('Library noncontiguous Trash chooses the survivor after the focused removed item, or previous at the end',async()=>{
 for(const focusedIndex of [5,7]){const f=fixture();await f.ready();const values=navigationItems(f,{image:8,text:0,link:0}).image.map(value=>({...value,pinned:true}));f.api.emit({items:values});await f.ready();await f.key('KeyL');await f.cardClick(values[1].id);await f.cardClick(values[focusedIndex].id,{ctrl:true});assert.deepEqual(selectedCards(f),[values[1].id,values[focusedIndex].id]);assert.equal(focusedCard(f),values[focusedIndex].id);await f.key('KeyS');assert.equal(focusedCard(f),values[6].id);assert.deepEqual(selectedCards(f),[values[6].id]);await f.key('Backspace');assert.deepEqual(values.map(value=>f.state.items.find(item=>item.id===value.id).trashedAt),Array(8).fill(null));}
});

test('confirmed Library Trash preserves its captured dialog and selection when commit fails, then retries with next-item focus',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);await f.click('trash');assert.match(f.overlay,/aria-label="Move to Trash"/);const command=f.api.command;
 f.api.command=async(action,payload)=>{if(action==='trashUndoably')throw new Error('Synthetic Trash persistence failure');return command(action,payload);};
 await f.key('Enter');await f.ready();assert.match(f.overlay,/aria-label="Move to Trash"/);assert.match(f.nodes.get('toast').textContent,/Synthetic Trash persistence failure/);assert.equal(focusedCard(f),f.image);assert.deepEqual(selectedCards(f),[f.image]);assert.equal(f.state.items.find(value=>value.id===f.image).trashedAt,null);
 f.api.command=command;await f.key('Enter');await f.ready();assert.equal(f.overlay,'');assert.equal(focusedCard(f),f.text1);assert.deepEqual(selectedCards(f),[f.text1]);
});


test('IME composing Enter Escape and arrows stay native in Library search, text preview editing and modal fields',async()=>{
 for(const ime of [{composing:true},{keyCode:229}]){
  const search=fixture();await search.ready();await keyboardSaved(search);await search.input('search-input','Text');const field=search.editor('search-input'),before=search.commands.length,initialFocus=focusedCard(search),initialSelection=selectedCards(search);
  for(const code of ['Enter','Escape','ArrowDown','ArrowRight'])assert.equal((await search.key(code,{...ime,target:field})).prevented,undefined);
  assert.equal(focusedCard(search),initialFocus);assert.deepEqual(selectedCards(search),initialSelection);assert.equal(search.nodes.get('search-input').value,'Text');assert.equal(search.commands.length,before);
  const text=fixture();await text.ready();await keyboardSaved(text);await text.key('ArrowRight');await text.key('KeyE');await text.input('text-editor','Synthetic composing draft');const editor=text.editor('text-editor'),textCommands=text.commands.length;
  for(const [code,mods]of [['Enter',{ctrl:true}],['Escape',{}],['ArrowLeft',{}],['KeyP',{}]])assert.equal((await text.key(code,{...ime,...mods,target:editor})).prevented,undefined);
  assert.match(text.overlay,/id="text-editor"/);assert.equal(text.nodes.get('text-editor').value,'Synthetic composing draft');assert.equal(text.commands.length,textCommands);
  const modal=fixture();await modal.ready();await keyboardSaved(modal);await modal.key('KeyP',{shift:true});await modal.input('modal-query','Synthetic composing folder');const query=modal.editor('modal-query'),modalCommands=modal.commands.length;
  for(const code of ['Enter','Escape','ArrowDown'])assert.equal((await modal.key(code,{...ime,target:query})).prevented,undefined);
  assert.match(modal.overlay,/aria-label="Pin to folder"/);assert.equal(modal.nodes.get('modal-query').value,'Synthetic composing folder');assert.equal(modal.commands.length,modalCommands);
 }
});

test('closing a Settings shortcut recorder restores focus to its opening control',async()=>{
 const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'../../contracts/shortcut-recording.json'),'utf8'));
 const policy=contract.nativeExceptions?.find(entry=>entry.id==='shortcut-recorder-return-focus');
 assert.ok(policy,'The cross-platform shortcut recorder contract must document native focus return');
 assert.match(policy.windows,/Record button/);
 assert.match(policy.macos,/NSPanel/);
 const f=fixture({trackFocus:true});await f.ready();await f.api.command('settings');await f.ready();await f.click('settings-tab',{tab:'shortcuts'});await f.click('record-local',{keyAction:'pin'});assert.match(f.main,/id="settings-record-local-pin"/);
 const trigger=f.lastClick;assert.ok(f.focused?.insideOverlay);assert.notEqual(f.focused,trigger);
 await f.key('Escape');assert.equal(f.overlay,'');assert.equal(f.focused?.id,trigger.id);assert.notEqual(f.focused,trigger);assert.equal(f.focused?.isConnected,true);
});

test('an old shortcut save completion cannot close a newer recorder or release its owned global-shortcut lease',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();await f.click('record-local',{keyAction:'pin'});await f.ready();await f.key('KeyO');const release=f.deferReply('setSettings');await f.click('confirm-modal');await f.key('Escape');await f.click('record-local',{keyAction:'copy'});await f.ready();const begin=f.commands.filter(value=>value.action==='beginShortcutRecording').at(-1);assert.ok(begin);release();await f.ready();assert.match(f.overlay,/Record shortcut/);assert.equal(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===begin.payload.token),false);await f.key('Escape');assert.equal(f.commands.some(value=>value.action==='endShortcutRecording'&&value.payload.token===begin.payload.token),true);
});

// Kırpma modu (Alt+Shift+S): seçimden sonra Ctrl+C de Enter gibi kaydedip
// panoya kopyalar ve kırpma ekranını kapatır; metin aracında yazarken Ctrl+C
// normal metin kopyalamasında kalır.
function captureFixture(){const f=fixture();f.api.surface({view:'capture',windowVisible:true,pendingCapture:{id:'cap-1',dataUrl:'data:image/png;base64,AAAA',width:900,height:220}});return f;}
test('capture: Ctrl+C commits the capture like Enter (copies and closes)',async()=>{
 const f=captureFixture();await f.ready();
 await f.key('KeyC',{ctrl:true});
 assert.equal(f.commands.filter(value=>value.action==='commitCapture').length,1);
});
test('capture: Ctrl+C inside a text annotation editor does not commit',async()=>{
 const f=captureFixture();await f.ready();
 await f.key('KeyC',{ctrl:true,target:f.editor('capture-text')});
 assert.equal(f.commands.filter(value=>value.action==='commitCapture').length,0);
});
test('capture: Enter still commits exactly once',async()=>{
 const f=captureFixture();await f.ready();
 await f.key('Enter');
 assert.equal(f.commands.filter(value=>value.action==='commitCapture').length,1);
});

async function openMarkup(f){await f.ready();await f.key('Space');await f.key('KeyM');}
async function savedMarkup(f){const before=f.commands.filter(value=>value.action==='saveImage').length;await f.key('KeyS',{ctrl:true});const saves=f.commands.filter(value=>value.action==='saveImage');assert.equal(saves.length,before+1,'markup change must dirty the editor');return saves.at(-1).payload.annotations;}
async function drag(f,[x0,y0],[x1,y1]){await f.pointer('pointerdown',x0,y0);await f.pointer('pointermove',x1,y1);await f.pointer('pointerup',x1,y1);}

test('editor opens legacy document unchanged',async()=>{
 const legacy=structuredClone(golden.annotations),crop={x:5,y:6,width:300,height:150};
 const f=fixture();await f.ready();f.api.emit({items:f.state.items.map(value=>value.id===f.image?{...value,annotations:structuredClone(legacy),crop:structuredClone(crop)}:value)});await openMarkup(f);
 const calls=f.markupCalls,start=calls.map(call=>call[0]==='call'&&call[1]==='clearRect').lastIndexOf(true);
 assert.ok(start>=0,'markup overlay painted');assert.deepEqual(calls.slice(start+1),golden.calls);
 await f.key('KeyS',{ctrl:true});assert.equal(f.commands.filter(value=>value.action==='saveImage').length,0,'opening a legacy document must not dirty it');
 await f.click('image-tool',{tool:'crop'});await f.key('Enter');assert.equal(f.commands.filter(value=>value.action==='saveImage').length,0,'applying an unchanged crop must not save');assert.match(f.overlay,/data-tool="select" aria-pressed="true"/);
 // (a) a net no-op edit saves the legacy document exactly as it was stored.
 await f.click('image-tool',{tool:'rectangle'});await drag(f,[400,100],[500,180]);await f.key('KeyZ',{ctrl:true});
 let saved=await savedMarkup(f),payload=f.commands.filter(value=>value.action==='saveImage').at(-1).payload;
 assert.deepEqual(payload.crop,crop);assert.deepEqual(saved,legacy);
 // (b) moving one old-type annotation changes only its position.
 await f.click('image-tool',{tool:'select'});await drag(f,[110,20],[130,30]);
 saved=await savedMarkup(f);payload=f.commands.filter(value=>value.action==='saveImage').at(-1).payload;
 assert.deepEqual(payload.crop,crop);assert.equal(saved.length,legacy.length);
 const {x,y,...rest}=saved[2],{x:x0,y:y0,...restBefore}=legacy[2];assert.deepEqual(rest,restBefore);assert.ok(Math.abs(x-(x0+20))<1e-9&&Math.abs(y-(y0+10))<1e-9,'moved by the pointer delta (canvas mapping may add float noise)');
 saved.forEach((value,index)=>{if(index!==2)assert.deepEqual(value,legacy[index]);});
});

test('editor redo with Ctrl+Shift+Z and Ctrl+Y',async()=>{
 const f=fixture();await openMarkup(f);await f.click('image-tool',{tool:'rectangle'});await drag(f,[100,50],[200,120]);
 await f.key('KeyZ',{ctrl:true});assert.equal((await savedMarkup(f)).length,0);
 await f.key('KeyZ',{ctrl:true,shift:true});assert.equal((await savedMarkup(f)).length,1);
 await f.key('KeyZ',{ctrl:true});assert.equal((await savedMarkup(f)).length,0);
 await f.key('KeyY',{ctrl:true});const redone=await savedMarkup(f);assert.equal(redone.length,1);assert.equal(redone[0].type,'rectangle');
});

test('editor Delete removes selected annotation',async()=>{
 const f=fixture();await openMarkup(f);await f.click('image-tool',{tool:'rectangle'});await drag(f,[100,50],[200,120]);
 await f.click('image-tool',{tool:'select'});await f.pointer('pointerdown',100,50);await f.pointer('pointerup',100,50);
 await f.key('Delete',{target:f.editor('fill-color')});assert.equal((await savedMarkup(f)).length,1,'Delete while typing in a control keeps the annotation');
 await f.key('Delete');assert.equal((await savedMarkup(f)).length,0);
});

test('editor number tool places 1 then 2',async()=>{
 const f=fixture();await openMarkup(f);assert.match(f.overlay,/data-action="image-tool"[^>]*data-tool="number"/);await f.click('image-tool',{tool:'number'});
 await f.pointer('pointerdown',100,100);await f.pointer('pointerup',100,100);await f.pointer('pointerdown',300,100);await f.pointer('pointerup',300,100);
 const saved=await savedMarkup(f);assert.deepEqual(saved.map(value=>[value.type,value.value,value.x,value.y]),[['number',1,100,100],['number',2,300,100]]);
});

test('editor blur tool adds blur annotation',async()=>{
 const f=fixture();await openMarkup(f);assert.match(f.overlay,/data-action="image-tool"[^>]*data-tool="blur"/);assert.match(f.overlay,/data-action="image-tool"[^>]*data-tool="pixelate"/);
 await f.click('image-tool',{tool:'blur'});f.paintCalls.length=0;await drag(f,[100,50],[300,150]);
 assert.ok(f.paintCalls.some(value=>value.canvas===''&&value.operation==='drawImage'&&value.source==='original'),'blur samples the decoded original image');
 const saved=await savedMarkup(f);assert.deepEqual(saved.map(value=>[value.type,value.x,value.y,value.width,value.height,value.strength]),[['blur',100,50,200,100,50]]);
});

test('editor fill color input edits selected',async()=>{
 const f=fixture();await openMarkup(f);for(const id of ['fill-color','font-family','font-color','shadow','strength','stamp-number'])assert.match(f.overlay,new RegExp('id="'+id+'"'));
 await f.click('image-tool',{tool:'rectangle'});await drag(f,[100,50],[200,120]);const drawn=(await savedMarkup(f))[0];
 await f.click('image-tool',{tool:'select'});await f.pointer('pointerdown',150,50);await f.pointer('pointerup',150,50);
 await f.input('fill-color','#00ff00');const [edited]=await savedMarkup(f);
 assert.equal(edited.fillColor,'#00ff00');assert.deepEqual([edited.id,edited.type,edited.x,edited.y,edited.width,edited.height],[drawn.id,drawn.type,drawn.x,drawn.y,drawn.width,drawn.height]);
});

async function capturePointer(f,type,x,y,options={}){await f.pointer(type,x,y,{canvas:'capture-canvas',...options});}
async function captureDrag(f,[x0,y0],[x1,y1],options={}){await capturePointer(f,'pointerdown',x0,y0,options);await capturePointer(f,'pointermove',x1,y1,options);await capturePointer(f,'pointerup',x1,y1,options);}
// The renderer is an IIFE, so tests read the capture document from what it last painted:
// annotations, plus the blur clip (the crop when one exists, else the full 900x220 image).
const captureDoc=f=>{const last=f.drawn.at(-1);assert.ok(last,'capture painted');const full=last.clip&&last.clip.x===0&&last.clip.y===0&&last.clip.width===900&&last.clip.height===220;return{annotations:last.annotations,crop:full?null:last.clip,base:last.base};};
const captureToolPressed=tool=>new RegExp(`data-action="capture-tool"[^>]*data-tool="${tool}" aria-pressed="true"`);
async function captureText(f,x,y,text){await f.key('KeyT');await capturePointer(f,'pointerdown',x,y);await capturePointer(f,'pointerup',x,y);await f.input('simple-input',text);await f.click('confirm-modal');}

test('capture key v selects, n number, u blur, p pixelate',async()=>{
 const f=captureFixture();await f.ready();
 for(const [code,tool]of [['KeyV','select'],['KeyN','number'],['KeyU','blur'],['KeyP','pixelate']]){await f.key(code);assert.match(f.main,captureToolPressed(tool),code+' picks '+tool);}
 for(const id of ['capture-color','capture-width','capture-fill','capture-fill-color','capture-font-family','capture-font-color','capture-text-size','capture-shadow','capture-strength','capture-stamp-number','capture-redo'])assert.match(f.main,new RegExp('id="'+id+'"|data-action="'+id+'"'),id+' is rendered');
 for(const id of ['ink-color','fill-color','font-color','strength','stamp-number'])assert.doesNotMatch(f.main,new RegExp('id="'+id+'"'),'capture never reuses editor id '+id);
 await f.key('KeyN');await capturePointer(f,'pointerdown',100,100);await capturePointer(f,'pointerup',100,100);await capturePointer(f,'pointerdown',300,100);await capturePointer(f,'pointerup',300,100);
 assert.deepEqual(captureDoc(f).annotations.map(value=>[value.type,value.value]),[['number',1],['number',2]]);
 await f.key('KeyU');f.paintCalls.length=0;await captureDrag(f,[100,50],[300,150]);
 assert.ok(f.paintCalls.some(value=>value.canvas===''&&value.operation==='drawImage'&&value.source==='original'),'blur samples the decoded screenshot');
 await f.key('KeyP');await captureDrag(f,[400,50],[500,150]);
 assert.deepEqual(captureDoc(f).annotations.slice(2).map(value=>[value.type,value.x,value.y,value.width,value.height]),[['blur',100,50,200,100],['pixelate',400,50,100,100]]);
 f.paintCalls.length=0;await f.key('Enter');
 assert.equal(f.commands.filter(value=>value.action==='commitCapture').length,1);
 assert.ok(f.paintCalls.some(value=>value.canvas===''&&value.operation==='drawImage'&&value.source==='original'),'the committed PNG blurs from the same screenshot');
});

test('capture redo Ctrl+Shift+Z and Ctrl+Y',async()=>{
 const f=captureFixture();await f.ready();
 await captureDrag(f,[10,10],[200,150]);const crop=captureDoc(f).crop;assert.ok(crop&&crop.width>100,'crop drawn');
 await f.key('KeyR');await captureDrag(f,[50,50],[120,100]);assert.equal(captureDoc(f).annotations.length,1);
 await f.key('KeyZ',{ctrl:true});assert.equal(captureDoc(f).annotations.length,0);assert.deepEqual(captureDoc(f).crop,crop);
 await f.key('KeyZ',{ctrl:true,shift:true});assert.equal(captureDoc(f).annotations.length,1);
 await f.key('KeyZ',{ctrl:true});await f.key('KeyZ',{ctrl:true});assert.equal(captureDoc(f).crop,null,'undo covers crop changes');
 await f.key('KeyY',{ctrl:true});assert.deepEqual(captureDoc(f).crop,crop);
 await f.key('KeyY',{ctrl:true});assert.equal(captureDoc(f).annotations[0].type,'rectangle');
 await f.click('capture-undo');assert.equal(captureDoc(f).annotations.length,0);await f.click('capture-redo');assert.equal(captureDoc(f).annotations.length,1);
});

const captureCommits=f=>f.commands.filter(value=>value.action==='commitCapture').length;
const crop0=async f=>{await captureDrag(f,[100,50],[300,150]);return captureDoc(f).crop;};
// Q2: the commit carries only the rendered PNG to encode; main cuts the clean original from its
// own copy of the screenshot after the clipboard write and hide.
test('commit sends rendered PNG, original rect and offset annotations',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await f.key('KeyR');await captureDrag(f,[120,60],[180,100]);await captureDrag(f,[400,60],[450,100]);
 await f.key('Enter');
 const commits=f.commands.filter(value=>value.action==='commitCapture');assert.equal(commits.length,1);
 const {dataUrl,originalRect,annotations}=commits[0].payload;
 assert.match(dataUrl,/^data:image\/png;base64,/);assert.equal(Object.hasOwn(commits[0].payload,'originalDataUrl'),false,'no second PNG encode before the commit');
 assert.deepEqual(originalRect,{x:100,y:50,width:200,height:100});
 assert.equal(annotations.length,2,'annotations outside the crop stay in the document');
 const near=(a,b)=>Math.abs(a-b)<1e-6;
 assert.ok(near(annotations[0].x,20)&&near(annotations[0].y,10)&&near(annotations[0].width,60)&&near(annotations[0].height,40),'translated by -crop origin');
 assert.ok(near(annotations[1].x,300)&&near(annotations[1].y,10));
});
test('commit without annotations sends no original',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);await f.key('Enter');
 const [commit]=f.commands.filter(value=>value.action==='commitCapture');
 assert.match(commit.payload.dataUrl,/^data:image\/png;base64,/);
 assert.equal(Object.hasOwn(commit.payload,'originalRect'),false);assert.equal(Object.hasOwn(commit.payload,'originalDataUrl'),false);assert.equal(Object.hasOwn(commit.payload,'annotations'),false);
});
test('arrow keys move crop',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await f.key('ArrowRight');await f.key('ArrowDown');
 assert.deepEqual(captureDoc(f).crop,{x:110,y:60,width:200,height:100});
 await f.key('ArrowLeft');assert.equal(captureDoc(f).crop.x,100);
 await f.key('KeyZ',{ctrl:true});assert.deepEqual(captureDoc(f).crop,{x:100,y:50,width:200,height:100},'consecutive arrows are one undo step');
});
test('shift+arrow moves crop 1px',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await f.key('ArrowRight',{shift:true});await f.key('ArrowUp',{shift:true});
 assert.deepEqual(captureDoc(f).crop,{x:101,y:49,width:200,height:100});
});
test('alt+arrow resizes crop',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await f.key('ArrowRight',{alt:true});await f.key('ArrowDown',{alt:true});
 assert.deepEqual(captureDoc(f).crop,{x:100,y:50,width:210,height:110});
 await f.key('ArrowLeft',{alt:true});await f.key('ArrowUp',{alt:true});
 assert.deepEqual(captureDoc(f).crop,{x:100,y:50,width:200,height:100});
});
test('alt+shift+arrow resizes 1px',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await f.key('ArrowRight',{alt:true,shift:true});await f.key('ArrowDown',{alt:true,shift:true});
 assert.deepEqual(captureDoc(f).crop,{x:100,y:50,width:201,height:101});
});
test('crop clamps to image bounds',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 for(let i=0;i<30;i++)await f.key('ArrowLeft');for(let i=0;i<30;i++)await f.key('ArrowUp');
 assert.deepEqual(captureDoc(f).crop,{x:0,y:0,width:200,height:100});
 for(let i=0;i<100;i++)await f.key('ArrowRight');for(let i=0;i<100;i++)await f.key('ArrowDown');
 assert.deepEqual(captureDoc(f).crop,{x:700,y:120,width:200,height:100});
 for(let i=0;i<100;i++)await f.key('ArrowRight',{alt:true});for(let i=0;i<100;i++)await f.key('ArrowDown',{alt:true});
 assert.deepEqual(captureDoc(f).crop,{x:700,y:120,width:200,height:100});
});
test('arrow keys do nothing with a drawing tool or inside a field',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await f.key('ArrowRight',{target:f.editor('capture-text')});assert.equal(captureDoc(f).crop.x,100);
 await f.key('KeyB');await f.key('ArrowRight');assert.equal(captureDoc(f).crop.x,100);
});
// A real double-click: two presses (the second with detail 2) then dblclick at the same point.
async function captureDoubleClick(f,x,y){for(const detail of [1,2]){await f.dispatch('pointerdown',{clientX:x,clientY:y,pointerId:1,detail});await f.dispatch('pointerup',{clientX:x,clientY:y,pointerId:1,detail});}await f.dispatch('dblclick',{clientX:x,clientY:y,detail:2});}
test('double-click with crop tool commits',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);
 await captureDoubleClick(f,200,100);assert.equal(captureCommits(f),1);
});
test('double-click outside the crop does not commit and keeps the crop',async()=>{
 const f=captureFixture();await f.ready();const crop=await crop0(f);
 await captureDoubleClick(f,600,180);
 assert.equal(captureCommits(f),0,'outside the selection is not a commit');
 assert.deepEqual(captureDoc(f).crop,crop,'the clicks of a double-click do not replace the crop');
 await captureDoubleClick(f,150,80);assert.equal(captureCommits(f),1,'inside commits exactly once');
});
test('double-click with pen tool does not commit',async()=>{
 const f=captureFixture();await f.ready();await f.key('KeyB');await f.dispatch('dblclick');assert.equal(captureCommits(f),0);
});
test('right-click clears crop and keeps annotations',async()=>{
 const f=captureFixture();await f.ready();await crop0(f);await f.key('KeyR');await captureDrag(f,[120,60],[180,100]);
 const event=await f.dispatch('contextmenu');
 assert.equal(event.prevented,true);assert.equal(captureDoc(f).crop,null);assert.equal(captureDoc(f).annotations.length,1);
 await f.dispatch('pointerdown',{button:2,clientX:5,clientY:5});assert.equal(captureDoc(f).crop,null,'right button never starts a crop');
});
test('right-click reset is undoable',async()=>{
 const f=captureFixture();await f.ready();const crop=await crop0(f);
 await f.dispatch('contextmenu');assert.equal(captureDoc(f).crop,null);
 await f.key('KeyZ',{ctrl:true});assert.deepEqual(captureDoc(f).crop,crop);
});
test('shift during crop drag shows magnifier',async()=>{
 const f=captureFixture();await f.ready();
 const baseDraws=()=>f.paintCalls.filter(value=>value.canvas==='capture-canvas'&&value.operation==='drawImage'&&value.source==='original').length;
 await capturePointer(f,'pointerdown',100,50);
 let before=baseDraws();await capturePointer(f,'pointermove',200,100);assert.equal(baseDraws()-before,1,'no magnifier without Shift');
 before=baseDraws();await capturePointer(f,'pointermove',210,110,{shift:true});assert.equal(baseDraws()-before,2,'magnifier patch painted with Shift');
 before=baseDraws();await f.dispatch('keyup',{key:'Shift',code:'ShiftLeft'});assert.equal(baseDraws()-before,1,'released Shift repaints without the magnifier');
 await capturePointer(f,'pointermove',220,110,{shift:true});await capturePointer(f,'pointerup',220,110);
 before=baseDraws();await f.dispatch('keyup',{key:'Shift',code:'ShiftLeft'});assert.equal(baseDraws()-before,0,'nothing left to hide after the drag');
});
test('capture pointer moves repaint at most once per animation frame',async()=>{
 const f=fixture({queuedAnimationFrames:true});f.api.surface({view:'capture',windowVisible:true,pendingCapture:{id:'cap-1',dataUrl:'data:image/png;base64,AAAA',width:900,height:220}});await f.ready();f.flushAnimationFrames();
 await capturePointer(f,'pointerdown',100,50);f.flushAnimationFrames();f.paintCalls.length=0;
 for(const x of [120,140,160,180])await capturePointer(f,'pointermove',x,100);
 assert.equal(f.animationFrames.length,1);f.flushAnimationFrames();
 assert.equal(f.paintCalls.filter(value=>value.canvas==='capture-canvas'&&value.operation==='clearRect').length,1);
 assert.deepEqual(captureDoc(f).crop,{x:100,y:50,width:80,height:50});
});
test('capture shift snaps arrow',async()=>{
 const f=captureFixture();await f.ready();await f.key('KeyA');
 await captureDrag(f,[100,100],[200,110],{shift:true});
 const [arrow]=captureDoc(f).annotations;assert.equal(arrow.type,'arrow');assert.ok(Math.abs(arrow.height)<1e-9,'snapped to horizontal');assert.ok(Math.abs(arrow.width-Math.hypot(100,10))<1e-9);
});

test('capture select tool moves annotation',async()=>{
 const f=captureFixture();await f.ready();await f.key('KeyR');await captureDrag(f,[100,50],[200,120]);
 const before=captureDoc(f).annotations[0];
 await f.key('KeyV');await captureDrag(f,[150,50],[170,60]);
 const after=captureDoc(f).annotations[0];
 assert.deepEqual([after.id,after.type,after.width,after.height],[before.id,before.type,before.width,before.height]);assert.ok(Math.abs(after.x-(before.x+20))<1e-9&&Math.abs(after.y-(before.y+10))<1e-9,'moved by the pointer delta (canvas mapping may add float noise)');
 await f.key('KeyZ',{ctrl:true});assert.deepEqual(captureDoc(f).annotations[0],before);
});

test('capture tool keys ignored in editor field',async()=>{
 const f=captureFixture();await f.ready();assert.match(f.main,captureToolPressed('crop'));
 for(const code of ['KeyV','KeyN','KeyU','KeyP','KeyR']){const event=await f.key(code,{target:f.editor('capture-stamp-number')});assert.ok(!event.prevented);assert.match(f.main,captureToolPressed('crop'),code+' typed in a field keeps the tool');}
 await f.key('KeyV');assert.match(f.main,captureToolPressed('select'));
});

test('capture style edits apply to the selection only with the select tool',async()=>{
 const f=captureFixture();await f.ready();await captureText(f,100,100,'Hi');
 let [text]=captureDoc(f).annotations;assert.equal(text.type,'text');assert.equal(text.fontColor,'#ff5252');
 await f.input('capture-font-color','#00ff00');assert.equal(captureDoc(f).annotations[0].fontColor,'#ff5252','text tool style edits do not rewrite the new text');
 await f.key('KeyV');await capturePointer(f,'pointerdown',110,90);await capturePointer(f,'pointerup',110,90);
 await f.input('capture-font-color','#0000ff');assert.equal(captureDoc(f).annotations[0].fontColor,'#0000ff');
 await f.key('KeyR');await captureDrag(f,[300,50],[400,120]);assert.equal(captureDoc(f).annotations[1].fontColor,undefined);assert.equal(captureDoc(f).annotations[1].color,'#ff5252');
});

test('editor style edits apply to the selection only with the select tool',async()=>{
 const f=fixture();await openMarkup(f);await f.click('image-tool',{tool:'text'});
 await f.pointer('pointerdown',100,100);await f.pointer('pointerup',100,100);await f.input('simple-input','Hi');await f.click('confirm-modal');
 await f.input('font-color','#00ff00');assert.equal((await savedMarkup(f))[0].fontColor,'#ff5252','text tool style edits do not rewrite the new text');
 await f.click('image-tool',{tool:'select'});await f.pointer('pointerdown',110,90);await f.pointer('pointerup',110,90);
 await f.input('font-color','#0000ff');assert.equal((await savedMarkup(f))[0].fontColor,'#0000ff');
});

test('capture main colour also colours new text; the text colour picker still overrides',async()=>{
 const f=captureFixture();await f.ready();
 await f.input('capture-color','#0000ff');assert.equal(f.nodes.get('capture-font-color').value,'#0000ff','text colour picker follows');
 await captureText(f,100,100,'Hi');assert.equal(captureDoc(f).annotations[0].fontColor,'#0000ff');
 await f.input('capture-font-color','#00ff00');await captureText(f,300,100,'Yo');assert.equal(captureDoc(f).annotations[1].fontColor,'#00ff00');
 await f.key('KeyV');await capturePointer(f,'pointerdown',110,90);await capturePointer(f,'pointerup',110,90);
 await f.input('capture-color','#123456');assert.deepEqual([captureDoc(f).annotations[0].color,captureDoc(f).annotations[0].fontColor],['#123456','#123456'],'select tool: main colour recolours the selected text');assert.equal(captureDoc(f).annotations[1].fontColor,'#00ff00');
});
test('editor main colour also colours new text',async()=>{
 const f=fixture();await openMarkup(f);await f.input('ink-color','#0000ff');await f.click('image-tool',{tool:'text'});
 await f.pointer('pointerdown',100,100);await f.pointer('pointerup',100,100);await f.input('simple-input','Hi');await f.click('confirm-modal');
 const [text]=await savedMarkup(f);assert.equal(text.color,'#0000ff');assert.equal(text.fontColor,'#0000ff');
});
test('capture and editor markup labels are translated to Turkish',async()=>{
 const f=captureFixture();await f.ready();f.api.emit({settings:{...f.state.settings,language:'tr'}});await f.ready();
 for(const label of ['Numara damgası','Bulanıklaştır','Pikselleştir','Dolgu rengi','Yazı tipi','Metin rengi','Gölge','Efekt gücü','Sonraki numara','Yinele'])assert.ok(f.main.includes(label),label);
});

test('capture Delete removes selected annotation',async()=>{
 const f=captureFixture();await f.ready();await f.key('KeyR');await captureDrag(f,[100,50],[200,120]);await captureDrag(f,[300,50],[400,120]);
 let event=await f.key('Delete');assert.ok(!event.prevented,'nothing selected: Delete does nothing');assert.equal(captureDoc(f).annotations.length,2);
 await f.key('KeyV');await capturePointer(f,'pointerdown',150,50);await capturePointer(f,'pointerup',150,50);
 event=await f.key('Delete');assert.ok(event.prevented);assert.deepEqual(captureDoc(f).annotations.map(value=>value.x),[300]);
 event=await f.key('Backspace');assert.ok(!event.prevented,'selection cleared after delete');assert.equal(captureDoc(f).annotations.length,1);
 await capturePointer(f,'pointerdown',350,50);await capturePointer(f,'pointerup',350,50);await f.key('Backspace');assert.equal(captureDoc(f).annotations.length,0);
 await f.key('KeyZ',{ctrl:true});await f.key('KeyZ',{ctrl:true});assert.equal(captureDoc(f).annotations.length,1,'undo restores the last delete');
 // A select click that hits an annotation is itself a history step (engine), so two more undos restore the first delete.
 await f.key('KeyZ',{ctrl:true});await f.key('KeyZ',{ctrl:true});assert.equal(captureDoc(f).annotations.length,2,'deletes are undoable');
 assert.equal(f.commands.filter(value=>['commitCapture','cancelCapture'].includes(value.action)).length,0);
});

test('capture Delete inside an editor field does nothing',async()=>{
 const f=captureFixture();await f.ready();await f.key('KeyR');await captureDrag(f,[100,50],[200,120]);
 await f.key('KeyV');await capturePointer(f,'pointerdown',150,50);await capturePointer(f,'pointerup',150,50);
 for(const code of ['Delete','Backspace']){const event=await f.key(code,{target:f.editor('capture-stamp-number')});assert.ok(!event.prevented,code+' stays native in a field');assert.equal(captureDoc(f).annotations.length,1);}
 await f.key('Delete');assert.equal(captureDoc(f).annotations.length,0);
});

// ---- Output menu and Library output actions
const outputCommands=f=>f.commands.filter(value=>value.action.startsWith('output')&&value.action!=='outputInfo');
const outputRows=html=>[...html.matchAll(/data-output="([^"]+)"(?: data-app="([^"]*)")?(?: data-language="([^"]*)")?/g)].map(match=>({action:match[1],app:match[2],language:match[3]}));
function fakeCard(id){const card={dataset:{itemId:id},closest:selector=>selector==='[data-item-id]'?card:null};return card;}

test('image preview Export button opens the output menu with every action',async()=>{
 const f=fixture();await f.ready();await f.key('Space');assert.match(f.overlay,/data-action="output-menu"/);await f.click('output-menu');
 const rows=outputRows(f.menu).map(row=>row.action);
 for(const action of ['save','saveAs','copyLocation','reveal','openWith','print','extractText','scanCode'])assert.ok(rows.includes(action),action);
 assert.ok(!rows.includes('share'),'share hidden when unavailable');assert.match(f.menu,/role="menu"/);assert.match(f.menu,/data-app="org.kde.gwenview"/);assert.match(f.menu,/Gwenview/);
 assert.deepEqual(outputRows(f.menu).filter(row=>row.action==='extractText').map(row=>row.language||''),['','eng','tur']);
 f.outputConfig.info.shareAvailable=true;f.outputConfig.info.codeAvailable=false;await f.key('Escape');
});

test('output menu hides unavailable rows and shows Share when available',async()=>{
 const f=fixture();f.outputConfig.info.shareAvailable=true;f.outputConfig.info.codeAvailable=false;await f.ready();await f.key('Space');await f.click('output-menu');
 const rows=outputRows(f.menu).map(row=>row.action);assert.ok(rows.includes('share'));assert.ok(!rows.includes('scanCode'));
});

test('Ctrl+S on a focused image saves a PNG without encoding',async()=>{
 const f=fixture();await f.ready();const event=await f.key('KeyS',{ctrl:true});assert.ok(event.prevented);
 assert.deepEqual(outputCommands(f).map(value=>[value.action,value.payload]),[['outputPlan',{id:f.image,mode:'save'}],['outputWrite',{token:'tok-1'}]]);
 await f.key('KeyS',{ctrl:true,shift:true});assert.deepEqual(outputCommands(f).at(-2).payload,{id:f.image,mode:'saveAs'});
});

test('Ctrl+S on a text item does nothing and a canceled plan writes nothing',async()=>{
 const f=fixture();await f.ready();await f.key('ArrowDown');await f.key('KeyS',{ctrl:true});assert.equal(outputCommands(f).length,0);
 await f.key('ArrowUp');f.outputConfig.plan={canceled:true};await f.key('KeyS',{ctrl:true,shift:true});assert.deepEqual(outputCommands(f).map(value=>value.action),['outputPlan']);
});

test('jpg plans send an encoded data URL with the plan token',async()=>{
 const f=fixture();f.outputConfig.plan={token:'tok-jpg',path:'/home/u/Pictures/a.jpg',format:'jpg',quality:80};await f.ready();await f.key('KeyS',{ctrl:true});
 const write=outputCommands(f).find(value=>value.action==='outputWrite');assert.equal(write.payload.token,'tok-jpg');assert.match(write.payload.dataUrl,/^data:image\/jpeg/);
 f.outputConfig.plan={token:'tok-webp',path:'/x.webp',format:'webp',quality:70};await f.key('KeyS',{ctrl:true});assert.match(outputCommands(f).at(-1).payload.dataUrl,/^data:image\/webp/);
});

test('copy location saves first when main asks',async()=>{
 const f=fixture();f.outputConfig.runResults=[{needsSave:true},{copied:true}];await f.ready();await f.key('Space');await f.click('output-menu');await f.click('output-run',{output:'copyLocation'});
 assert.deepEqual(outputCommands(f).map(value=>value.action),['outputRun','outputPlan','outputWrite','outputRun']);assert.equal(outputCommands(f)[0].payload.action,'copyLocation');assert.equal(outputCommands(f)[3].payload.id,f.image);assert.equal(f.menu,'');
});

test('menu rows send app and a single OCR language to outputRun',async()=>{
 const f=fixture();await f.ready();await f.key('Space');await f.click('output-menu');await f.click('output-run',{output:'openWith',app:'org.kde.gwenview'});
 assert.deepEqual(outputCommands(f)[0].payload,{id:f.image,action:'openWith',app:'org.kde.gwenview'});
 await f.click('output-menu');await f.click('output-run',{output:'extractText',language:'tur'});assert.deepEqual(outputCommands(f)[1].payload,{id:f.image,action:'extractText',languages:['tur']});
 await f.click('output-menu');await f.click('output-run',{output:'extractText'});assert.deepEqual(outputCommands(f)[2].payload,{id:f.image,action:'extractText'});
});

test('right-click on an image card opens the output menu; on a text card it does not',async()=>{
 const f=fixture();await f.ready();const image=await f.dispatch('contextmenu',{target:fakeCard(f.image),clientX:30,clientY:40});assert.ok(image.prevented);assert.match(f.menu,/data-output="save"/);
 await f.key('Escape');assert.equal(f.menu,'');const text=await f.dispatch('contextmenu',{target:fakeCard(f.text1),clientX:30,clientY:40});assert.ok(!text.prevented);assert.equal(f.menu,'');
 f.state.items.find(value=>value.id===f.image).trashedAt=1;f.api.emit({items:f.state.items});await f.ready();await f.dispatch('contextmenu',{target:fakeCard(f.image)});assert.equal(f.menu,'');
});

test('output menu keyboard: ArrowDown + Enter runs the second action, Escape closes',async()=>{
 const f=fixture();await f.ready();await f.key('KeyE',{ctrl:true});assert.match(f.menu,/data-output="save"/);
 await f.key('ArrowDown');await f.key('Enter');assert.equal(f.menu,'');assert.equal(outputCommands(f)[0].payload.mode,'saveAs');
 await f.key('Space');await f.key('KeyE',{ctrl:true});assert.match(f.menu,/role="menu"/);await f.key('Escape');assert.equal(f.menu,'');assert.match(f.overlay,/id="preview-dialog"/,'Escape closes only the menu');
 await f.key('KeyE',{ctrl:true});await f.key('ArrowUp');await f.key('Enter');assert.ok(outputCommands(f).length>1);
});

test('output shortcuts never fire in image markup; Ctrl+S there still saves markup',async()=>{
 const f=fixture({imageDocument:true});await f.ready();await f.key('Space');await f.key('KeyM');await f.ready();
 await f.key('KeyS',{ctrl:true,shift:true});await f.key('KeyE',{ctrl:true});assert.equal(outputCommands(f).length,0);assert.equal(f.menu,'');
 await f.key('KeyS',{ctrl:true});assert.equal(outputCommands(f).length,0);assert.match(f.overlay,/id="markup-canvas"/,'Ctrl+S stays with the markup editor');
});

test('Actions palette lists output entries and disables them for text',async()=>{
 const f=fixture();await f.ready();await f.key('KeyK',{ctrl:true});assert.match(f.overlay,/data-command="output-copyLocation"/);assert.match(f.overlay,/data-command="output-scanCode"/);assert.match(f.overlay,/data-command="output-save"/);
 await f.key('Escape');await f.key('ArrowDown');await f.key('KeyK',{ctrl:true});assert.match(f.overlay,/data-command="output-print"[^>]*disabled/);assert.match(f.overlay,/Select a still image first\./);
});

test('Turkish UI shows Turkish output labels',async()=>{
 const f=fixture();f.api.emit({settings:{...f.state.settings,language:'tr'}});await f.ready();await f.key('Space');await f.click('output-menu');
 for(const label of ['Farklı kaydet…','Konumu kopyala','QR kodu tara','İçeren klasörü aç','Birlikte aç','Yazdır','Metni çıkar · Turkish'])assert.ok(f.menu.includes(label),label);
 assert.match(f.overlay,/Dışa aktar/);
});

test('the output menu closes on view change, window hide and when its item is gone',async()=>{
 const open=async()=>{const f=fixture();await f.ready();await f.key('KeyE',{ctrl:true});assert.match(f.menu,/role="menu"/);return f;};
 let f=await open();f.api.emit({view:'capture'});await f.ready();assert.equal(f.menu,'');
 f=await open();f.api.surface({windowVisible:false});await f.ready();assert.equal(f.menu,'');
 f=await open();f.api.emit({items:f.state.items.map(value=>value.id===f.image?{...value,trashedAt:5}:value)});await f.ready();assert.equal(f.menu,'');
 f=await open();f.api.emit({items:f.state.items.filter(value=>value.id!==f.image)});await f.ready();assert.equal(f.menu,'');
 f=await open();f.api.emit({libraryRevision:3});await f.ready();assert.match(f.menu,/role="menu"/,'unrelated packets keep the menu');
 f.api.emit({view:'capture'});await f.ready();await f.key('ArrowDown');assert.equal(outputCommands(f).length,0,'stale menu no longer swallows keys');
});

test('Keyboard shortcut settings list the output actions and Turkish error strings exist',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.api.emit({settings:{...f.state.settings,language:'tr'}});await f.ready();
 f.api.emit({view:'settings'});await f.ready();await f.click('settings-tab',{tab:'shortcuts'});
 for(const label of ['Görseli dosyaya kaydet','Görseli farklı kaydet…','Dışa aktarma menüsü'])assert.ok(f.main.includes(label),label);
 const source=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');assert.ok(source.includes('"Özgün görsel açılamadı."')&&source.includes('"İşlem tamamlanamadı."'));
});

// ---- Capture overlay output actions
const CAPTURED='00000000-0000-4000-8000-0000000000c1';
async function outputCaptureFixture(language){const f=captureFixture();f.outputConfig.captureId=CAPTURED;if(language)f.api.emit({settings:{...f.state.settings,language}});await f.ready();return f;}
const captureCommit=f=>f.commands.filter(value=>value.action==='commitCapture');
test('capture Ctrl+S commits without copying then saves',async()=>{
 const f=await outputCaptureFixture();await crop0(f);await f.key('KeyR');await captureDrag(f,[120,60],[180,100]);
 const event=await f.key('KeyS',{ctrl:true});assert.ok(event.prevented);
 const [commit]=captureCommit(f);assert.equal(captureCommit(f).length,1);assert.equal(commit.payload.copy,false);assert.match(commit.payload.dataUrl,/^data:image\/png;base64,/);assert.ok(commit.payload.originalRect&&commit.payload.annotations.length===1);
 const {copy,...rest}=commit.payload;assert.deepEqual(Object.keys(rest).sort(),['annotations','dataUrl','originalRect']);
 assert.deepEqual(outputCommands(f).map(value=>[value.action,value.payload]),[['outputPlan',{id:CAPTURED,mode:'save'}],['outputWrite',{token:'tok-1'}]]);
});
test('capture Ctrl+Shift+S plans Save As for the committed item',async()=>{
 const f=await outputCaptureFixture();await f.key('KeyS',{ctrl:true,shift:true});assert.equal(captureCommit(f)[0].payload.copy,false);assert.deepEqual(outputCommands(f)[0].payload,{id:CAPTURED,mode:'saveAs'});
});
test('capture Enter and Ctrl+C payloads are unchanged',async()=>{
 for(const press of [()=>['Enter'],()=>['KeyC',{ctrl:true}]]){
  const f=await outputCaptureFixture();await crop0(f);await f.key(...press());
  const [commit]=captureCommit(f);assert.equal(Object.hasOwn(commit.payload,'copy'),false);assert.deepEqual(Object.keys(commit.payload),['dataUrl']);assert.equal(outputCommands(f).length,0);
 }
});
test('capture Ctrl+Shift+C copies the location',async()=>{
 const f=await outputCaptureFixture();await f.key('KeyC',{ctrl:true,shift:true});
 assert.equal(captureCommit(f)[0].payload.copy,false);assert.deepEqual(outputCommands(f).map(value=>[value.action,value.payload]),[['outputRun',{id:CAPTURED,action:'copyLocation'}]]);
});
test('capture output keys are ignored in a text field',async()=>{
 const f=await outputCaptureFixture();
 for(const [code,mods]of [['KeyS',{ctrl:true}],['KeyS',{ctrl:true,shift:true}],['KeyC',{ctrl:true,shift:true}],['KeyP',{ctrl:true}],['KeyE',{ctrl:true}]])await f.key(code,{...mods,target:f.editor('capture-text')});
 assert.equal(captureCommit(f).length,0);assert.equal(outputCommands(f).length,0);assert.equal(f.menu,'');
});
test('capture Ctrl+P prints the committed item',async()=>{
 const f=await outputCaptureFixture();await f.key('KeyP',{ctrl:true});assert.equal(captureCommit(f)[0].payload.copy,false);assert.deepEqual(outputCommands(f)[0].payload,{id:CAPTURED,action:'print'});
});
test('capture toolbar shows Save, Save As and Export',async()=>{
 const f=await outputCaptureFixture('tr');
 for(const [needle,label]of [['data-action="capture-output" data-output="save"','Kaydet'],['data-action="capture-output" data-output="saveAs"','Farklı kaydet…'],['data-action="capture-output-menu"','Dışa aktar']]){const at=f.main.indexOf(needle);assert.ok(at>0,needle);assert.ok(f.main.slice(at,at+400).includes(label),label);}
 assert.ok(f.main.indexOf('data-action="capture-output-menu"')<f.main.indexOf('data-action="cancel-capture"'));assert.match(f.main,/<kbd>Ctrl\+S<\/kbd>/);assert.match(f.main,/<kbd>Ctrl\+E<\/kbd>/);
 await f.click('capture-output',{output:'saveAs'});assert.equal(captureCommit(f)[0].payload.copy,false);assert.equal(outputCommands(f)[0].payload.mode,'saveAs');
});
test('Escape closes the output menu before cancelling the capture',async()=>{
 const f=await outputCaptureFixture();await f.key('KeyE',{ctrl:true});assert.match(f.menu,/role="menu"/);
 await f.key('Escape');assert.equal(f.menu,'');assert.equal(f.commands.filter(value=>value.action==='cancelCapture').length,0);assert.match(f.main,/id="capture-canvas"/);
 await f.key('Escape');assert.equal(f.commands.filter(value=>value.action==='cancelCapture').length,1);
});
test('capture menu Print runs on the committed item',async()=>{
 const f=await outputCaptureFixture();await f.click('capture-output-menu');assert.match(f.menu,/role="menu"/);await f.click('output-run',{output:'print'});
 assert.equal(captureCommit(f)[0].payload.copy,false);assert.deepEqual(outputCommands(f).map(value=>[value.action,value.payload]),[['outputRun',{id:CAPTURED,action:'print'}]]);assert.equal(f.menu,'');
});
test('capture menu keyboard run passes app and language through captureOutput',async()=>{
 const f=await outputCaptureFixture();await f.click('capture-output-menu');await f.click('output-run',{output:'openWith',app:'org.kde.gwenview'});
 assert.deepEqual(outputCommands(f)[0].payload,{id:CAPTURED,action:'openWith',app:'org.kde.gwenview'});
});
test('a failed capture commit restores the session and does not run the output',async()=>{
 const f=await outputCaptureFixture();f.api.command=(orig=>async(action,payload)=>{if(action==='commitCapture')throw new Error('disk full');return orig(action,payload);})(f.api.command);
 await f.key('KeyS',{ctrl:true});assert.equal(outputCommands(f).length,0);assert.match(f.main,/id="capture-canvas"/);
 await f.key('KeyS',{ctrl:true});assert.equal(outputCommands(f).length,0,'busy was reset and the retry also fails cleanly');
});

test('Space typed into a text field never runs the selected output row',async()=>{
 const f=fixture();await f.ready();await f.key('KeyE',{ctrl:true});assert.match(f.menu,/role="menu"/);
 const field=f.editor('modal-query');await f.key('Space',{target:field});
 assert.equal(outputCommands(f).length,0,'no output action ran');
 await f.key('KeyE',{ctrl:true});await f.key('Space');assert.equal(outputCommands(f).length,2,'Space outside a field still runs the row');
});

test('Actions palette disables Share and Scan QR code when outputInfo says they are unavailable',async()=>{
 const f=fixture();await f.ready();await f.key('KeyK',{ctrl:true});
 assert.doesNotMatch(f.overlay,/data-command="output-share"[^>]*disabled/,'unknown availability keeps the entry enabled');await f.key('Escape');
 f.outputConfig.info.shareAvailable=false;f.outputConfig.info.codeAvailable=false;await f.key('KeyE',{ctrl:true});await f.key('Escape');
 await f.key('KeyK',{ctrl:true});
 assert.match(f.overlay,/data-command="output-share"[^>]*disabled/);assert.match(f.overlay,/data-command="output-scanCode"[^>]*disabled/);
 assert.match(f.overlay,/Sharing needs KDE Purpose \(qml6\)\./);assert.match(f.overlay,/QR code scanning needs zbarimg \(zbar\)\./);
 assert.doesNotMatch(f.overlay,/data-command="output-print"[^>]*disabled/);
});

test('a failed jpg encode is reported to main instead of writing',async()=>{
 const f=fixture();f.outputConfig.plan={token:'tok-jpg',path:'/home/u/Pictures/a.jpg',format:'jpg',quality:80};await f.ready();f.failExportOnce();await f.key('KeyS',{ctrl:true});
 const sent=outputCommands(f).map(value=>value.action);assert.deepEqual(sent,['outputPlan','outputFailed']);
 assert.deepEqual(outputCommands(f)[1].payload,{token:'tok-jpg',message:'Synthetic canvas export rejection'});
});

test('Turkish palette shows the translated unavailable reason',async()=>{
 const f=fixture();f.api.emit({settings:{...f.state.settings,language:'tr'}});f.outputConfig.info.codeAvailable=false;await f.ready();
 await f.key('KeyE',{ctrl:true});await f.key('Escape');await f.key('KeyK',{ctrl:true});
 assert.match(f.overlay,/QR kod taraması için zbarimg \(zbar\) gerekli\./);assert.match(f.overlay,/Paylaşım için KDE Purpose \(qml6\) gerekli\./);
});

// ---- Direct "Extract text" buttons (Spectacle shows Extract Text on the toolbar)
test('capture toolbar Extract text button commits without copying then extracts text',async()=>{
 const f=await outputCaptureFixture('tr');const needle='data-action="capture-output" data-output="extractText"';const at=f.main.indexOf(needle);assert.ok(at>0,needle);assert.ok(f.main.slice(at,at+300).includes('Metni çıkar'));
 await f.click('capture-output',{output:'extractText'});assert.equal(captureCommit(f)[0].payload.copy,false);assert.deepEqual(outputCommands(f).map(value=>[value.action,value.payload]),[['outputRun',{id:CAPTURED,action:'extractText'}]]);
});
test('image preview Extract text button runs extractText on the previewed image',async()=>{
 const f=fixture();await f.ready();await f.key('Space');assert.match(f.overlay,/data-action="output-extract-text"/);await f.click('output-extract-text');
 assert.deepEqual(outputCommands(f).map(value=>[value.action,value.payload]),[['outputRun',{id:f.image,action:'extractText'}]]);
});

test('a capture crop owns Enter before the next render tick can copy and hide the shelves',async()=>{
 const f=fixture();await f.ready();
 f.api.emit({viewEvent:{serial:'immediate-capture-crop',selectId:f.image,kind:'image',preview:true,crop:true}});
 await f.key('Enter');
 assert.equal(f.commands.filter(value=>value.action==='copy').length,0,'Enter belongs to the capture crop immediately');
 assert.equal(f.state.windowVisible,true,'Applying the crop keeps its preview open');
 await f.ready();
 assert.doesNotMatch(f.overlay,/id="markup-canvas"/,'An unchanged crop finishes back in preview');
 await f.key('Enter');
 assert.equal(f.commands.filter(value=>value.action==='copy').length,1,'Enter in the finished preview copies normally');
 assert.equal(f.state.windowVisible,false);
});

test('export and shortcut-conflict notices follow the selected language',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clipboardline-export-notice-')),png=path.join(directory,'source.png'),missing='00000000-0000-4000-8000-000000000005';
 try{
  fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
  const output=path.join(directory,'export');fs.mkdirSync(output);
  const f=fixture({exporter:selected=>exportCopies(selected,output,{mediaPath:id=>{if(id===missing)throw new Error('Image unavailable');return png;}})});await f.ready();
  f.api.emit({settings:{...f.state.settings,language:'tr'},items:[...f.state.items,{...structuredClone(f.state.items[0]),id:missing,name:'Missing image',createdAt:500,updatedAt:500}]});await f.ready();
  await f.key('KeyA',{ctrl:true});await f.key('KeyE',{ctrl:true,shift:true});await f.ready();
  const exportCommand=f.commands.find(value=>value.action==='export');assert.equal(exportCommand.payload.ids.length,2);
  assert.deepEqual(fs.readdirSync(output),['Synthetic image.png']);
  assert.equal(f.state.message,'Exported 1 · failed 1');
  assert.equal(f.nodes.get('toast').textContent,'1 dışa aktarıldı · 1 başarısız');
  f.api.emit({message:'Copied'});await f.ready();assert.equal(f.nodes.get('toast').textContent,'Kopyalandı');
  f.api.emit({message:'Synthetic untranslated notice'});await f.ready();assert.equal(f.nodes.get('toast').textContent,'Synthetic untranslated notice');
  await f.api.command('settings');await f.ready();await f.click('record-local',{keyAction:'pin'});await f.key('KeyS');await f.click('confirm-modal');
  assert.equal(f.nodes.get('toast').textContent,"Bu kısayol Çöp Kutusu'na taşı için zaten kullanılıyor");
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('after unpinning the focused card in pinned-only mode, the next arrow selects the first remaining card like macOS',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f,{image:4,text:0,link:0}).image.map(value=>({...value,pinned:true}));f.api.emit({items:values});await f.ready();
 await f.key('KeyF');assert.equal(focusedCard(f),values[0].id);
 await f.key('KeyP');assert.equal(f.state.items.find(value=>value.id===values[0].id).pinned,false);
 await f.key('ArrowRight');assert.equal(focusedCard(f),values[1].id);
});
test('Tab onto an empty shelf leaves copy, take down, pin and preview with nothing to act on',async()=>{
 const f=fixture();await f.ready();f.api.emit({items:f.state.items.filter(value=>value.kind!=='text')});await f.ready();
 await f.key('Tab');assert.equal(activeKind(f),'text');const commands=f.commands.length;
 for(const [code,extra]of [['Enter',{}],['KeyS',{}],['KeyP',{}],['Space',{}],['KeyC',{ctrl:true}]])await f.key(code,extra);
 assert.deepEqual(f.commands.slice(commands),[]);assert.equal(f.overlay,'');assert.equal(f.state.items.find(value=>value.id===f.image).trashedAt,null);assert.equal(f.state.windowVisible,true);
});
test('Library selection counts use the shared "%d selected" catalog entry in the chosen language',async()=>{
 const f=fixture();await f.ready();await f.key('KeyP');await f.key('ArrowDown');await f.key('KeyP');await f.api.command('library');await f.ready();await f.key('KeyA',{ctrl:true});
 for(const [language,expected]of [['tr','2 seçili'],['es','2 seleccionadas'],['zh-Hans','已选择 2 项'],['en','2 selected']]){f.api.emit({settings:{...f.state.settings,language}});await f.ready();assert.match(f.main,new RegExp('<span>'+expected+'</span>'),language);assert.match(f.main,new RegExp('<h2>'+expected+'</h2>'),language+' inspector');await f.click('add-to-folder');assert.match(f.overlay,new RegExp('<p>'+expected+' · '),language+' folder picker');await f.click('close-modal');}
});
for(const row of [{code:'ArrowUp',key:'ArrowUp',saved:'Control+Alt+Up'},{code:'ArrowLeft',key:'ArrowLeft',shift:true,saved:'Control+Alt+Shift+Left'},{code:'Equal',key:'+',shift:true,saved:'Control+Alt+Shift+Plus'}])test('global recorder saves Electron accelerator names for DOM-only keys: '+JSON.stringify(row),async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');await f.ready();await f.click('record-global',{keyAction:'search'});
 await f.key(row.code,{key:row.key,ctrl:true,alt:true,shift:!!row.shift});await f.click('confirm-modal');
 assert.equal(f.commands.filter(value=>value.action==='setSettings').at(-1).payload.patch.shortcuts.search,row.saved);
});
test('Settings shortcut filter matches the displayed localized action titles as well as the English ones',async()=>{
 const f=fixture();await f.ready();await f.api.command('settings');f.api.emit({settings:{...f.state.settings,language:'tr'}});await f.ready();await f.click('settings-tab',{tab:'shortcuts'});
 const rows=()=>[...f.main.matchAll(/data-action="record-local" data-key-action="([^"]+)"/g)].map(match=>match[1]);
 await f.input('shortcut-filter','kopyala');assert.ok(rows().includes('copy'));assert.ok(!rows().includes('pin'));
 await f.input('shortcut-filter','Sabitle');assert.ok(rows().includes('pin'));assert.ok(!rows().includes('copy'));
 await f.input('shortcut-filter','copy');assert.ok(rows().includes('copy'));
});
test('the empty-selection toast uses the shared "Select an item first" catalog entry',async()=>{
 const f=fixture();await f.ready();
 f.api.emit({items:[],settings:{...f.state.settings,language:'tr'}});await f.ready();await f.key('KeyC',{ctrl:true});
 assert.equal(f.nodes.get('toast').textContent,'Önce bir öğe seç');
});
test('the Move to Trash confirmation uses the shared localized catalog entry',async()=>{
 const f=fixture();await f.ready();await keyboardSaved(f);
 f.api.emit({settings:{...f.state.settings,language:'tr'}});await f.ready();await f.click('trash');
 assert.match(f.overlay,/1 içerik geri alınabilir Çöp’e taşınsın mı\?/);
 f.api.emit({settings:{...f.state.settings,language:'en'}});await f.click('close-modal');await f.click('trash');
 assert.match(f.overlay,/Move 1 items to recoverable Trash\?/);
});

test('shelf M opens focused photo for marker drawing and Escape saves editable marks',async()=>{
 const f=fixture();await f.ready();
 const other={...structuredClone(f.state.items.find(value=>value.id===f.image)),id:'20000000-0000-4000-8000-000000000099',name:'Another photo',mediaUrl:'appmedia://media/20000000-0000-4000-8000-000000000099/image'};
 f.api.emit({items:[other,...f.state.items]});await f.ready();await f.cardClick(f.image);assert.equal(focusedCard(f),f.image);
 await f.key('KeyM');assert.match(f.overlay,/id="markup-canvas"/);assert.ok(f.imageLoads.at(-1).url.includes(f.image));
 await f.key('KeyH');await f.pointer('pointerdown',60,40);await f.pointer('pointermove',250,100);await f.pointer('pointerup',250,100);
 await f.key('Escape');const saved=f.state.items.find(value=>value.id===f.image);
 assert.equal(saved.annotations.length,1);assert.equal(saved.annotations[0].type,'marker');assert.ok(saved.annotations[0].points.length>=2);
 assert.doesNotMatch(f.overlay,/id="markup-canvas"/);await f.key('Escape');await f.key('KeyM');
 await f.key('Escape');assert.equal(f.state.items.find(value=>value.id===f.image).annotations[0].type,'marker');
 });

test('shelf markup does not consume M in native editors or open text and link items',async()=>{
 for(const name of ['search-input','detail-note','modal-value']){
  const f=fixture();await f.ready();const editor=f.editor(name);const event=await f.key('KeyM',{target:editor});
  assert.ok(!event.prevented,name);assert.equal(f.overlay,'');assert.equal(f.commands.length,0);
 }
 for(const kind of ['text','link']){
  const f=fixture();await f.ready();await f.cardClick(kind==='text'?f.text1:f.link);await f.key('KeyM');assert.equal(f.overlay,'');
 }
 const f=fixture();await f.ready();f.api.emit({settings:{...f.state.settings,localShortcuts:{markup:'X'}}});await f.ready();
 await f.key('KeyM');assert.equal(f.overlay,'');await f.key('KeyX');assert.match(f.overlay,/id="markup-canvas"/);
 await f.key('Escape');await f.key('Escape');f.api.emit({settings:{...f.state.settings,localShortcuts:{markup:''}}});await f.ready();
 await f.key('KeyM');await f.key('KeyX');assert.equal(f.overlay,'');
 });
test('Take down of a ctrl-selected pair continues right of the removed focus like macOS',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f,{image:6,text:0,link:0}).image;f.api.emit({items:values});await f.ready();
 await f.cardClick(values[2].id,{ctrl:true});assert.deepEqual(selectedCards(f),[values[0].id,values[2].id]);assert.equal(focusedCard(f),values[2].id);
 await f.key('KeyS');assert.equal(focusedCard(f),values[3].id);assert.deepEqual(selectedCards(f),[values[3].id]);
});
test('the corner cross on another card keeps the focused card like macOS',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f,{image:6,text:0,link:0}).image;f.api.emit({items:values});await f.ready();
 await f.key('ArrowRight');assert.equal(focusedCard(f),values[1].id);
 await f.click('card-remove',{id:values[0].id});assert.ok(f.state.items.find(value=>value.id===values[0].id).trashedAt||f.state.items.find(value=>value.id===values[0].id).hiddenFromShelf);
 assert.equal(focusedCard(f),values[1].id);assert.deepEqual(selectedCards(f),[values[1].id]);
});
test('Take down shows the page of the card it focuses next',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f,{image:25,text:0,link:0}).image;f.api.emit({items:values});await f.ready();
 for(let index=0;index<9;index++)await f.key('ArrowRight',{shift:true});assert.equal(focusedCard(f),values[9].id);
 await f.key('KeyS');assert.equal(focusedCard(f),values[10].id);assert.deepEqual(selectedCards(f),[values[10].id]);
});
test('the corner cross keeps an unselected focus selected',async()=>{
 const f=fixture();await f.ready();const values=navigationItems(f,{image:6,text:0,link:0}).image;f.api.emit({items:values});await f.ready();
 await f.cardClick(values[1].id,{ctrl:true});await f.cardClick(values[1].id,{ctrl:true});assert.equal(focusedCard(f),values[1].id);assert.deepEqual(selectedCards(f),[values[0].id]);
 await f.click('card-remove',{id:values[0].id});assert.equal(focusedCard(f),values[1].id);assert.deepEqual(selectedCards(f),[values[1].id]);
});
