'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../lib/annotations.cjs');
const style=(extra={})=>({...A.DEFAULT_STYLE,...extra});
function draw(doc,tool,from,to,options={},s=style()){const g=A.beginTool(doc,tool,from,s,options);A.updateTool(doc,g,to,options);A.endTool(doc,g);return g;}

test('rectangle gesture records x,y,width,height',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:10,y:10},{x:50,y:30});
 const a=doc.annotations[0];assert.deepEqual([a.type,a.x,a.y,a.width,a.height],['rectangle',10,10,40,20]);
});
test('shift snaps line to 45 degrees',()=>{
 const doc=A.createDocument();draw(doc,'line',{x:0,y:0},{x:100,y:90},{shift:true});
 const a=doc.annotations[0];assert.ok(Math.abs(a.width-a.height)<1e-9);assert.ok(a.width>0);
});
test('shift makes rectangle square',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:0,y:0},{x:100,y:-40},{shift:true});
 const a=doc.annotations[0];assert.equal(a.width,100);assert.equal(a.height,-100);
});
test('pen collects points',()=>{
 const doc=A.createDocument();const g=A.beginTool(doc,'pen',{x:1,y:1},style());
 A.updateTool(doc,g,{x:2,y:3});A.updateTool(doc,g,{x:4,y:5});A.endTool(doc,g);
 assert.deepEqual(doc.annotations[0].points,[{x:1,y:1},{x:2,y:3},{x:4,y:5}]);
});
test('number stamp increments',()=>{
 const doc=A.createDocument();draw(doc,'number',{x:5,y:5},{x:5,y:5});draw(doc,'number',{x:50,y:5},{x:50,y:5});
 assert.deepEqual(doc.annotations.map(a=>a.value),[1,2]);assert.equal(doc.nextNumber,3);
});
test('setNextNumber sets next stamp value',()=>{
 const doc=A.createDocument();A.setNextNumber(doc,7);draw(doc,'number',{x:5,y:5},{x:5,y:5});
 assert.equal(doc.annotations[0].value,7);assert.equal(doc.nextNumber,8);
});
test('createDocument derives nextNumber from existing stamps',()=>{
 assert.equal(A.createDocument({annotations:[{type:'number',value:4,x:0,y:0,width:0,height:0}]}).nextNumber,5);
});
test('undo restores nextNumber',()=>{
 const doc=A.createDocument();draw(doc,'number',{x:5,y:5},{x:5,y:5});draw(doc,'number',{x:50,y:5},{x:50,y:5});
 assert.equal(A.undo(doc),true);assert.equal(doc.nextNumber,2);assert.equal(doc.annotations.length,1);
});
test('undo/redo round-trip',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:0,y:0},{x:10,y:10});
 assert.equal(A.undo(doc),true);assert.equal(doc.annotations.length,0);
 assert.equal(A.redo(doc),true);assert.equal(doc.annotations.length,1);
 assert.equal(A.redo(doc),false);A.undo(doc);assert.equal(A.undo(doc),false);
});
test('new checkpoint clears redo',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:0,y:0},{x:10,y:10});A.undo(doc);
 assert.equal(doc.redo.length,1);A.checkpoint(doc);assert.equal(doc.redo.length,0);
});
test('history capped at 80',()=>{
 const doc=A.createDocument();for(let i=0;i<100;i++)A.checkpoint(doc);assert.equal(doc.history.length,80);
});
test('select gesture moves annotation',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:10,y:10},{x:110,y:110});
 const g=A.beginTool(doc,'select',{x:50,y:50},style());A.updateTool(doc,g,{x:60,y:70});A.endTool(doc,g);
 const a=doc.annotations[0];assert.equal(doc.selected,0);assert.deepEqual([a.x,a.y,a.width,a.height],[20,30,100,100]);
});
test('select gesture moves pen points',()=>{
 const doc=A.createDocument();const p=A.beginTool(doc,'pen',{x:10,y:10},style());A.updateTool(doc,p,{x:110,y:110});A.endTool(doc,p);
 const g=A.beginTool(doc,'select',{x:50,y:50},style());A.updateTool(doc,g,{x:55,y:60});
 assert.deepEqual(doc.annotations[0].points,[{x:15,y:20},{x:115,y:120}]);
});
test('resize handle grows rectangle',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:10,y:10},{x:110,y:110});
 const g=A.beginTool(doc,'select',{x:110,y:110},style());A.updateTool(doc,g,{x:130,y:150});
 const a=doc.annotations[0];assert.deepEqual([a.x,a.y,a.width,a.height],[10,10,120,140]);
});
test('select on empty space clears selection and returns no-op gesture',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:10,y:10},{x:20,y:20});doc.selected=0;
 const g=A.beginTool(doc,'select',{x:500,y:500},style());assert.equal(doc.selected,null);
 A.updateTool(doc,g,{x:600,y:600});A.endTool(doc,g);assert.equal(doc.annotations[0].x,10);
});
test('hitTest returns top-most',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:0,y:0},{x:100,y:100});draw(doc,'rectangle',{x:50,y:50},{x:150,y:150});
 assert.equal(A.hitTest(doc,{x:75,y:75}),1);assert.equal(A.hitTest(doc,{x:10,y:10}),0);assert.equal(A.hitTest(doc,{x:900,y:900}),-1);
});
test('deleteSelected removes and is undoable',()=>{
 const doc=A.createDocument();draw(doc,'rectangle',{x:0,y:0},{x:100,y:100});doc.selected=0;
 assert.equal(A.deleteSelected(doc),true);assert.equal(doc.annotations.length,0);assert.equal(doc.selected,null);
 assert.equal(A.deleteSelected(doc),false);A.undo(doc);assert.equal(doc.annotations.length,1);
});
test('applyStyle edits selected annotation fillColor',()=>{
 const doc=A.createDocument();assert.equal(A.applyStyle(doc,{fillColor:'#000'}),false);
 draw(doc,'rectangle',{x:0,y:0},{x:100,y:100});doc.selected=0;
 assert.equal(A.applyStyle(doc,{fillColor:'#00ff00'}),true);assert.equal(doc.annotations[0].fillColor,'#00ff00');
 A.undo(doc);assert.equal(doc.annotations[0].fillColor,A.DEFAULT_STYLE.fillColor);
});
test('blur and pixelate are rect gestures with strength from style',()=>{
 const doc=A.createDocument();draw(doc,'blur',{x:0,y:0},{x:40,y:30},{},style({strength:70}));draw(doc,'pixelate',{x:0,y:0},{x:20,y:20},{},style({strength:30}));
 assert.deepEqual(doc.annotations.map(a=>[a.type,a.width,a.height,a.strength]),[['blur',40,30,70],['pixelate',20,20,30]]);
});
test('addText inserts a selected text annotation',()=>{
 const doc=A.createDocument();const index=A.addText(doc,{x:5,y:60},'hi',style({fontSize:20}));
 assert.equal(index,0);assert.equal(doc.annotations[0].text,'hi');assert.equal(doc.annotations[0].fontSize,20);assert.equal(doc.selected,0);
});
test('none, text and crop do not start gestures',()=>{
 const doc=A.createDocument();for(const t of ['none','text','crop'])assert.equal(A.beginTool(doc,t,{x:0,y:0},style()),null);
});
test('annotationBounds matches legacy shapes',()=>{
 assert.deepEqual(A.annotationBounds({type:'rectangle',x:50,y:60,width:-20,height:-10}),{x:30,y:50,width:20,height:10});
 assert.deepEqual(A.annotationBounds({type:'pen',points:[{x:1,y:5},{x:9,y:2}]}),{x:1,y:2,width:8,height:3});
 assert.deepEqual(A.annotationBounds({type:'text',x:10,y:50,text:'ab\nc',fontSize:10}),{x:10,y:40,width:12.4,height:25});
});
test('document survives JSON round-trip',()=>{
 const doc=A.createDocument();draw(doc,'arrow',{x:0,y:0},{x:30,y:40});draw(doc,'number',{x:1,y:1},{x:1,y:1});
 const copy=JSON.parse(JSON.stringify(doc));assert.deepEqual(copy,doc);
 assert.equal(A.undo(copy),true);assert.equal(copy.nextNumber,1);
});
