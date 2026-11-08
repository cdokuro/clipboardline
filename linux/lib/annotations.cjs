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
 function restore(doc,state){doc.annotations=clone(state.annotations);doc.crop=state.crop?clone(state.crop):null;doc.nextNumber=state.nextNumber;if(doc.selected!=null&&!doc.annotations[doc.selected])doc.selected=null;}
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
 function applyStyle(doc,patch){if(doc.selected==null||!doc.annotations[doc.selected])return false;checkpoint(doc);Object.assign(doc.annotations[doc.selected],patch);return true;}
 function setNextNumber(doc,n){doc.nextNumber=Math.max(1,Math.floor(Number(n))||1);}
 const exports={TOOLS,DEFAULT_STYLE,createDocument,checkpoint,undo,redo,annotationBounds,hitTest,beginTool,updateTool,endTool,addText,deleteSelected,applyStyle,setNextNumber};
 if(typeof module==='object'&&module.exports)module.exports=exports;else scope.clipboardLineAnnotations=exports;
})(typeof window==='object'?window:globalThis);
