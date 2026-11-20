'use strict';
// Shared annotation engine core: document, history, hit-testing and tool
// gestures. Pure data in, pure data out; rendering and DOM stay in adapters.
(function(scope){
 const TOOLS=['none','select','crop','pen','marker','line','arrow','rectangle','ellipse','text','number','blur','pixelate'];
 const DEFAULT_STYLE={color:'#ff5252',widthPx:7,fill:false,fillColor:'#ff5252',fontFamily:'sans-serif',fontColor:'#ff5252',fontSize:40,shadow:false,strength:50};
 const HISTORY_LIMIT=80,HIT_TOLERANCE=12,RESIZE_HANDLE=25;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const nextFrom=annotations=>1+annotations.reduce((max,a)=>a&&a.type==='number'&&Number.isFinite(a.value)?Math.max(max,a.value):max,0);
 const nextId=doc=>1+doc.annotations.reduce((max,a)=>Math.max(max,Number.isFinite(a.id)?a.id:0),0);
 function createDocument({annotations=[],crop=null}={}){const list=clone(annotations);return{annotations:list,crop:crop?clone(crop):null,selected:null,history:[],redo:[],nextNumber:nextFrom(list)};}
 const snapshot=doc=>({annotations:clone(doc.annotations),crop:doc.crop?clone(doc.crop):null,nextNumber:doc.nextNumber});
 function restore(doc,state){doc.annotations=clone(state.annotations);doc.crop=state.crop?clone(state.crop):null;doc.nextNumber=state.nextNumber;doc.selected=null;}
 function checkpoint(doc){doc.history.push(snapshot(doc));if(doc.history.length>HISTORY_LIMIT)doc.history.splice(0,doc.history.length-HISTORY_LIMIT);doc.redo=[];}
 function undo(doc){if(!doc.history.length)return false;doc.redo.push(snapshot(doc));restore(doc,doc.history.pop());return true;}
 function redo(doc){if(!doc.redo.length)return false;doc.history.push(snapshot(doc));restore(doc,doc.redo.pop());return true;}
 function annotationBounds(annotation){
  if(annotation.points?.length){const xs=annotation.points.map(point=>point.x),ys=annotation.points.map(point=>point.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
  if(annotation.type==='text')return{x:annotation.x,y:annotation.y-(annotation.fontSize||40),width:Math.max(...String(annotation.text).split('\n').map(line=>line.length))*(annotation.fontSize||40)*.62,height:String(annotation.text).split('\n').length*(annotation.fontSize||40)*1.25};
  return{x:Math.min(annotation.x,annotation.x+annotation.width),y:Math.min(annotation.y,annotation.y+annotation.height),width:Math.abs(annotation.width),height:Math.abs(annotation.height)};
 }
 const within=(point,rect,padding=0)=>point.x>=rect.x-padding&&point.x<=rect.x+rect.width+padding&&point.y>=rect.y-padding&&point.y<=rect.y+rect.height+padding;
 function hitTest(doc,point,tolerance=HIT_TOLERANCE){for(let index=doc.annotations.length-1;index>=0;index--)if(within(point,annotationBounds(doc.annotations[index]),tolerance))return index;return -1;}
 function snapDelta(type,dx,dy){
  if(type==='rectangle'||type==='ellipse'||type==='blur'||type==='pixelate'){const size=Math.max(Math.abs(dx),Math.abs(dy));return{x:Math.sign(dx||1)*size,y:Math.sign(dy||1)*size};}
  const length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;return{x:Math.cos(angle)*length,y:Math.sin(angle)*length};
 }
 function beginTool(doc,tool,point,style,{shift=false}={}){
  if(!TOOLS.includes(tool)||['none','text','crop'].includes(tool))return null;
  const s={...DEFAULT_STYLE,...style};
  if(tool==='select'){
   const index=hitTest(doc,point);doc.selected=index<0?null:index;
   if(index<0)return{kind:'idle',tool,start:point};
   checkpoint(doc);
   const bounds=annotationBounds(doc.annotations[index]);
   const resize=Math.abs(point.x-(bounds.x+bounds.width))<RESIZE_HANDLE&&Math.abs(point.y-(bounds.y+bounds.height))<RESIZE_HANDLE;
   return{kind:resize?'resize':'move',tool,start:point,before:clone(doc.annotations[index]),index};
  }
  checkpoint(doc);
  const annotation={id:nextId(doc),type:tool,x:point.x,y:point.y,width:0,height:0,widthPx:s.widthPx,color:s.color,fill:!!s.fill,fillColor:s.fillColor};
  if(tool==='pen'||tool==='marker')annotation.points=[{x:point.x,y:point.y}];
  if(tool==='number'){annotation.value=doc.nextNumber;doc.nextNumber+=1;annotation.fontFamily=s.fontFamily;annotation.fontColor=s.fontColor;annotation.fontSize=s.fontSize;}
  if(tool==='blur'||tool==='pixelate')annotation.strength=s.strength;
  if(tool==='line'||tool==='arrow'||tool==='rectangle'||tool==='ellipse')annotation.shadow=!!s.shadow;
  doc.annotations.push(annotation);doc.selected=null;
  return{kind:'draw',tool,start:point,index:doc.annotations.length-1,shift};
 }
 function updateTool(doc,gesture,point,{shift=false}={}){
  if(!gesture||gesture.kind==='idle')return;
  const dx=point.x-gesture.start.x,dy=point.y-gesture.start.y;
  if(gesture.kind==='move'){
   const a=clone(gesture.before);a.x+=dx;a.y+=dy;if(a.points)a.points=a.points.map(p=>({x:p.x+dx,y:p.y+dy}));doc.annotations[gesture.index]=a;
  }else if(gesture.kind==='resize'){
   const a=clone(gesture.before);
   if(a.type==='text')a.fontSize=Math.max(10,(a.fontSize||40)+dy/3);
   else if(a.points){const b=annotationBounds(a),sx=Math.max(.1,(b.width+dx)/Math.max(1,b.width)),sy=Math.max(.1,(b.height+dy)/Math.max(1,b.height));a.points=a.points.map(p=>({x:b.x+(p.x-b.x)*sx,y:b.y+(p.y-b.y)*sy}));}
   else{a.width+=dx;a.height+=dy;}
   doc.annotations[gesture.index]=a;
  }else if(gesture.kind==='draw'){
   const a=doc.annotations[gesture.index];
   if(a.points)a.points.push({x:point.x,y:point.y});
   else if(a.type!=='number'){let x=dx,y=dy;if(shift){const snapped=snapDelta(a.type,dx,dy);x=snapped.x;y=snapped.y;}a.width=x;a.height=y;}
  }
 }
 function endTool(doc,gesture){if(gesture)gesture.done=true;}
 function addText(doc,point,text,style){
  const s={...DEFAULT_STYLE,...style};checkpoint(doc);
  doc.annotations.push({id:nextId(doc),type:'text',x:point.x,y:point.y,width:0,height:0,text:String(text),fontFamily:s.fontFamily,fontColor:s.fontColor,fontSize:s.fontSize,color:s.color,widthPx:s.widthPx,shadow:!!s.shadow});
  doc.selected=doc.annotations.length-1;return doc.selected;
 }
 function deleteSelected(doc){if(doc.selected==null||!doc.annotations[doc.selected])return false;checkpoint(doc);doc.annotations.splice(doc.selected,1);doc.selected=null;return true;}
 // Only DEFAULT_STYLE keys are applied; identity and geometry (id/type/points/x/y...) never change here.
 function applyStyle(doc,patch){if(doc.selected==null||!doc.annotations[doc.selected])return false;const style=Object.fromEntries(Object.entries(patch||{}).filter(([key])=>Object.hasOwn(DEFAULT_STYLE,key)));if(!Object.keys(style).length)return false;checkpoint(doc);Object.assign(doc.annotations[doc.selected],style);return true;}
 function setNextNumber(doc,n){doc.nextNumber=Math.max(1,Math.floor(Number(n))||1);}
 // Drawing. Legacy branches reproduce the original renderer call sequence exactly
 // (see tests/fixtures/annotations-golden.json); new style fields are optional.
 // Strength (1..100) mapping: blur radius = round(strength/5) px (min 1);
 // pixelate cell = round(strength/4) px (min 2). Number stamp: radius is
 // 0.6*fontSize (fontSize, else widthPx*4, else 40); digit uses a contrasting
 // black/white chosen from the fill's luminance, ignoring fontColor.
 const blurRadius=strength=>Math.max(1,Math.round((Number(strength)||DEFAULT_STYLE.strength)/5));
 const pixelCell=strength=>Math.max(2,Math.round((Number(strength)||DEFAULT_STYLE.strength)/4));
 function contrastColor(color){
  const m=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color));if(!m)return'#ffffff';
  let h=m[1];if(h.length===3)h=h.split('').map(c=>c+c).join('');
  const [r,g,b]=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
  return(0.299*r+0.587*g+0.114*b)>150?'#000000':'#ffffff';
 }
 function regionOf(annotation,clip){
  const b=annotationBounds(annotation);let x0=b.x,y0=b.y,x1=b.x+b.width,y1=b.y+b.height;
  if(clip){x0=Math.max(x0,clip.x);y0=Math.max(y0,clip.y);x1=Math.min(x1,clip.x+clip.width);y1=Math.min(y1,clip.y+clip.height);}
  return x1>x0&&y1>y0?{x:x0,y:y0,width:x1-x0,height:y1-y0}:null;
 }
 // Render cache: base identity -> bounded Map(key -> offscreen canvas). Engine-internal,
 // so annotations stay plain JSON. Key = effect + clamped region + radius/cell; a different
 // rect, clip (changes the region), strength or base misses. Each base keeps at most 32 entries
 // and CACHE_PIXEL_BUDGET canvas pixels (LRU eviction), so a box dragged out frame by frame
 // cannot pile up a canvas per frame; a render larger than the budget is not kept.
 // 16M px (~64 MB RGBA) still keeps one full-screen 4K blur.
 const renderCache=new WeakMap(),CACHE_LIMIT=32,CACHE_PIXEL_BUDGET=16*1024*1024;
 const pixelsOf=canvas=>(canvas.width||0)*(canvas.height||0);
 function cachedRender(base,key,make){
  if(!base||(typeof base!=='object'&&typeof base!=='function'))return make();
  let entries=renderCache.get(base);if(!entries){entries=new Map();renderCache.set(base,entries);}
  if(entries.has(key)){const hit=entries.get(key);entries.delete(key);entries.set(key,hit);return hit;}
  const made=make();if(!made)return made;
  const size=pixelsOf(made);if(size>CACHE_PIXEL_BUDGET)return made;
  let total=size;for(const canvas of entries.values())total+=pixelsOf(canvas);
  entries.set(key,made);
  while(entries.size>CACHE_LIMIT||total>CACHE_PIXEL_BUDGET){const oldest=entries.keys().next().value;total-=pixelsOf(entries.get(oldest));entries.delete(oldest);}
  return made;
 }
 function renderCacheStats(base){const entries=renderCache.get(base);let pixels=0;for(const canvas of entries?.values()||[])pixels+=pixelsOf(canvas);return{entries:entries?.size||0,pixels,budget:CACHE_PIXEL_BUDGET};}
 const defaultCanvas=()=>typeof document==='object'?document.createElement('canvas'):null;
 // Blur samples the rect padded by 2x radius (inside clip and the image) so the box edge mixes
 // real neighbours, not transparency; the scratch gets an opaque underlay (a 1px sample of the
 // same area stretched over it) so the sharp original never shows through where clip limits padding.
 function drawBlur(ctx,annotation,base,clip,createCanvas){
  const r=regionOf(annotation,clip);if(!base||!r)return;
  const make=createCanvas||defaultCanvas;if(typeof make!=='function')return;
  const radius=blurRadius(annotation.strength),pad=radius*2;
  let x0=Math.max(0,r.x-pad),y0=Math.max(0,r.y-pad),x1=r.x+r.width+pad,y1=r.y+r.height+pad;
  if(clip){x0=Math.max(x0,clip.x);y0=Math.max(y0,clip.y);x1=Math.min(x1,clip.x+clip.width);y1=Math.min(y1,clip.y+clip.height);}
  const bw=base.naturalWidth||base.width,bh=base.naturalHeight||base.height;
  if(Number.isFinite(bw)&&bw>0)x1=Math.min(x1,bw);if(Number.isFinite(bh)&&bh>0)y1=Math.min(y1,bh);
  const src={x:x0,y:y0,width:x1-x0,height:y1-y0};
  const scratch=cachedRender(base,`blur|${r.x}|${r.y}|${r.width}|${r.height}|${radius}|${src.x}|${src.y}|${src.width}|${src.height}`,()=>{
   const canvas=make();if(!canvas)return null;canvas.width=Math.ceil(src.width);canvas.height=Math.ceil(src.height);
   const sctx=canvas.getContext('2d');if(!sctx)return null;
   sctx.drawImage(base,src.x,src.y,src.width,src.height,0,0,1,1);
   sctx.drawImage(canvas,0,0,1,1,0,0,canvas.width,canvas.height);
   sctx.filter=`blur(${radius}px)`;sctx.drawImage(base,src.x,src.y,src.width,src.height,0,0,src.width,src.height);
   return canvas;
  });
  if(!scratch)return;
  ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
  ctx.drawImage(scratch,r.x-src.x,r.y-src.y,r.width,r.height,r.x,r.y,r.width,r.height);
 }
 function drawPixelate(ctx,annotation,base,clip,createCanvas){
  const r=regionOf(annotation,clip);if(!base||!r)return;
  const make=createCanvas||defaultCanvas;if(typeof make!=='function')return;
  const cell=pixelCell(annotation.strength),cols=Math.ceil(r.width/cell),rows=Math.ceil(r.height/cell);
  const scratch=cachedRender(base,`pixelate|${r.x}|${r.y}|${r.width}|${r.height}|${cell}`,()=>{
   const canvas=make();if(!canvas)return null;canvas.width=cols;canvas.height=rows;
   const sctx=canvas.getContext('2d');if(!sctx)return null;
   sctx.drawImage(base,r.x,r.y,r.width,r.height,0,0,cols,rows);
   return canvas;
  });
  if(!scratch)return;
  ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(scratch,0,0,cols,rows,r.x,r.y,cols*cell,rows*cell);
 }
 function drawAnnotations(context,annotations,{base=null,clip=null,createCanvas=null}={}){
  for(const annotation of annotations){
   context.save();
   context.strokeStyle=annotation.color||'#ff5252';
   context.fillStyle=annotation.type==='text'?(annotation.fontColor||annotation.color||'#ff5252'):(annotation.fillColor||annotation.color||'#ff5252');
   context.lineWidth=annotation.widthPx||annotation.strokeWidth||7;context.lineCap='round';context.lineJoin='round';
   if(annotation.shadow){context.shadowColor='rgba(0,0,0,.55)';context.shadowBlur=Math.max(6,context.lineWidth*1.5);context.shadowOffsetX=2;context.shadowOffsetY=3;}
   if(annotation.type==='pen'||annotation.type==='marker'){context.lineWidth=annotation.widthPx||7;if(annotation.type==='marker'){context.globalAlpha=.32;context.lineWidth*=3;}context.beginPath();(annotation.points||[]).forEach((point,index)=>index?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));context.stroke();}
   else if(annotation.type==='rectangle'){context.strokeRect(annotation.x,annotation.y,annotation.width,annotation.height);if(annotation.fill){context.globalAlpha=.18;context.fillRect(annotation.x,annotation.y,annotation.width,annotation.height);}}
   else if(annotation.type==='ellipse'){const b=annotationBounds(annotation);context.beginPath();context.ellipse(b.x+b.width/2,b.y+b.height/2,Math.max(1,b.width/2),Math.max(1,b.height/2),0,0,Math.PI*2);context.stroke();if(annotation.fill){context.globalAlpha=.18;context.fill();}}
   else if(annotation.type==='line'||annotation.type==='arrow'){const end={x:annotation.x+annotation.width,y:annotation.y+annotation.height};context.beginPath();context.moveTo(annotation.x,annotation.y);context.lineTo(end.x,end.y);context.stroke();if(annotation.type==='arrow'){const angle=Math.atan2(annotation.height,annotation.width),head=Math.max(18,context.lineWidth*4);context.beginPath();context.moveTo(end.x-head*Math.cos(angle-.5),end.y-head*Math.sin(angle-.5));context.lineTo(end.x,end.y);context.lineTo(end.x-head*Math.cos(angle+.5),end.y-head*Math.sin(angle+.5));context.stroke();}}
   else if(annotation.type==='text'){context.font=`${annotation.fontSize||40}px ${annotation.fontFamily||'Segoe UI, sans-serif'}`;String(annotation.text).split('\n').forEach((line,index)=>context.fillText(line,annotation.x,annotation.y+index*(annotation.fontSize||40)*1.25));}
   else if(annotation.type==='number'){
    const size=annotation.fontSize||(annotation.widthPx?annotation.widthPx*4:40),fill=annotation.fillColor||annotation.color||'#ff5252';
    context.beginPath();context.arc(annotation.x,annotation.y,size*.6,0,Math.PI*2);context.fill();
    context.shadowColor='transparent';context.fillStyle=contrastColor(fill);
    context.font=`bold ${size}px ${annotation.fontFamily||'sans-serif'}`;context.textAlign='center';context.textBaseline='middle';
    context.fillText(String(annotation.value),annotation.x,annotation.y);
   }
   else if(annotation.type==='blur')drawBlur(context,annotation,base,clip,createCanvas);
   else if(annotation.type==='pixelate')drawPixelate(context,annotation,base,clip,createCanvas);
   context.restore();
  }
 }
 const exports={TOOLS,drawAnnotations,DEFAULT_STYLE,createDocument,checkpoint,undo,redo,annotationBounds,hitTest,beginTool,updateTool,endTool,addText,deleteSelected,applyStyle,setNextNumber,renderCacheStats};
 if(typeof module==='object'&&module.exports)module.exports=exports;else scope.clipboardLineAnnotations=exports;
})(typeof window==='object'?window:globalThis);
