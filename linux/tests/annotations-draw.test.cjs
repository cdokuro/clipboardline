'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../lib/annotations.cjs');
const golden=require('./fixtures/annotations-golden.json');

function recorder(){
 const calls=[],vals={};
 const ctx=new Proxy({},{get:(t,p)=>p in vals?vals[p]:(...a)=>{calls.push(['call',p,a]);},set:(t,p,v)=>{vals[p]=v;calls.push(['set',p,v]);return true;}});
 return{ctx,calls};
}
const json=value=>JSON.parse(JSON.stringify(value));
const sets=(calls,name)=>calls.filter(c=>c[0]==='set'&&c[1]===name).map(c=>c[2]);
const invoked=(calls,name)=>calls.filter(c=>c[0]==='call'&&c[1]===name).map(c=>c[2]);
const BASE={tag:'base'};

test('legacy types draw identical calls to golden',()=>{
 const r=recorder();A.drawAnnotations(r.ctx,json(golden.annotations));
 assert.deepEqual(json(r.calls),golden.calls);
});
test('number draws filled circle and its value',()=>{
 const r=recorder();A.drawAnnotations(r.ctx,[{type:'number',x:100,y:80,value:7,color:'#ff0000',fontSize:40}]);
 assert.equal(invoked(r.calls,'arc').length,1);
 assert.ok(invoked(r.calls,'fill').length>=1);
 const [text,x,y]=invoked(r.calls,'fillText')[0];
 assert.equal(text,'7');assert.deepEqual([x,y],[100,80]);
 assert.equal(sets(r.calls,'textAlign')[0],'center');
});
test('number text contrasts with fill',()=>{
 const dark=recorder();A.drawAnnotations(dark.ctx,[{type:'number',x:0,y:0,value:1,color:'#101010'}]);
 const light=recorder();A.drawAnnotations(light.ctx,[{type:'number',x:0,y:0,value:1,color:'#fafafa'}]);
 assert.equal(sets(dark.calls,'fillStyle').pop(),'#ffffff');
 assert.equal(sets(light.calls,'fillStyle').pop(),'#000000');
});
test('fillColor used for fill, color for stroke',()=>{
 const r=recorder();A.drawAnnotations(r.ctx,[{type:'rectangle',x:0,y:0,width:10,height:10,color:'#111111',fillColor:'#222222',fill:true}]);
 assert.equal(sets(r.calls,'strokeStyle')[0],'#111111');
 assert.equal(sets(r.calls,'fillStyle')[0],'#222222');
});
test('fontFamily and fontColor used for text',()=>{
 const r=recorder();A.drawAnnotations(r.ctx,[{type:'text',x:0,y:20,text:'a',fontSize:30,color:'#111111',fontFamily:'Georgia, serif',fontColor:'#336699'}]);
 assert.equal(sets(r.calls,'font')[0],'30px Georgia, serif');
 assert.equal(sets(r.calls,'fillStyle')[0],'#336699');
});
test('shadow sets shadowBlur>0 only when on',()=>{
 const on=recorder();A.drawAnnotations(on.ctx,[{type:'line',x:0,y:0,width:5,height:5,color:'#fff',shadow:true}]);
 const off=recorder();A.drawAnnotations(off.ctx,[{type:'line',x:0,y:0,width:5,height:5,color:'#fff',shadow:false}]);
 assert.ok(sets(on.calls,'shadowBlur')[0]>0);
 assert.equal(sets(off.calls,'shadowBlur').length,0);
 assert.ok(on.calls.findIndex(c=>c[1]==='save')<on.calls.findIndex(c=>c[1]==='shadowBlur'));
 assert.equal(on.calls.at(-1)[1],'restore');
});
function scratchFactory(){const made=[];const create=()=>{const r=recorder();const c={width:0,height:0,getContext:()=>r.ctx,calls:r.calls};made.push(c);return c;};return{create,made};}
test('pixelate draws from base with cell size from strength',()=>{
 const f=scratchFactory(),r=recorder();
 A.drawAnnotations(r.ctx,[{type:'pixelate',x:10,y:20,width:100,height:60,strength:50}],{base:BASE,createCanvas:f.create});
 const down=f.made[0].calls.find(c=>c[1]==='drawImage')[2];
 assert.equal(down[0],BASE);assert.deepEqual(down.slice(1,5),[10,20,100,60]);
 assert.equal(f.made[0].width,Math.ceil(100/13)); // round(50/4)=13
 assert.equal(sets(r.calls,'imageSmoothingEnabled').pop(),false);
 const up=invoked(r.calls,'drawImage')[0];assert.equal(up[0],f.made[0]);
 const weak=scratchFactory();
 A.drawAnnotations(recorder().ctx,[{type:'pixelate',x:10,y:20,width:100,height:60,strength:10}],{base:BASE,createCanvas:weak.create});
 assert.ok(weak.made[0].width>f.made[0].width);
});
test('blur draws from base with filter from strength',()=>{
 const r=recorder();
 A.drawAnnotations(r.ctx,[{type:'blur',x:10,y:20,width:100,height:60,strength:50}],{base:BASE});
 assert.equal(sets(r.calls,'filter')[0],'blur(10px)');
 const [img,sx,sy,sw,sh,dx,dy,dw,dh]=invoked(r.calls,'drawImage')[0];
 assert.equal(img,BASE);assert.deepEqual([sx,sy,sw,sh],[10,20,100,60]);assert.deepEqual([dx,dy,dw,dh],[10,20,100,60]);
});
test('blur clamps to clip rect',()=>{
 const r=recorder();
 A.drawAnnotations(r.ctx,[{type:'blur',x:-50,y:0,width:100,height:40,strength:50}],{base:BASE,clip:{x:0,y:0,width:200,height:200}});
 const [,sx,sy,sw,sh]=invoked(r.calls,'drawImage')[0];
 assert.deepEqual([sx,sy,sw,sh],[0,0,50,40]);
});
test('blur handles negative size and draws nothing outside clip or without base',()=>{
 const r=recorder();
 A.drawAnnotations(r.ctx,[{type:'blur',x:60,y:40,width:-40,height:-30,strength:50}],{base:BASE});
 assert.deepEqual(invoked(r.calls,'drawImage')[0].slice(1,5),[20,10,40,30]);
 const out=recorder();
 A.drawAnnotations(out.ctx,[{type:'blur',x:300,y:0,width:20,height:20,strength:50}],{base:BASE,clip:{x:0,y:0,width:100,height:100}});
 assert.equal(invoked(out.calls,'drawImage').length,0);
 const none=recorder();
 A.drawAnnotations(none.ctx,[{type:'blur',x:0,y:0,width:20,height:20,strength:50},{type:'pixelate',x:0,y:0,width:20,height:20,strength:50}]);
 assert.equal(invoked(none.calls,'drawImage').length,0);
});
