const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('hall-map.js','utf8'),context);
const layout=vm.runInContext('HALL_LAYOUT',context);
test('complete physical layout: 31 unique places including PS5 and 10 VIP seats',()=>{
  assert.equal(layout.length,31);assert.equal(new Set(layout.map(p=>p.id)).size,31);
  assert.equal(layout.filter(p=>p.group==='vip').length,10);
  assert.ok(layout.some(p=>p.id==='1'&&p.zone==='ps5'));
  assert.ok(layout.every(p=>p.x>0&&p.x<100&&p.y>0&&p.y<100));
});
test('missing and stale data never imply free computers',()=>{
  const now=Date.now();
  assert.equal(context.liveHostStatus(null,now),'unknown');
  assert.equal(context.liveHostStatus({status:'free'},now),'unknown');
  assert.equal(context.liveHostStatus({status:'free',updated_at:new Date(now-31000).toISOString()},now),'unknown');
  assert.equal(context.liveHostStatus({status:'free',updated_at:new Date(now).toISOString()},now),'free');
  assert.equal(context.liveHostStatus({status:'reserved',updated_at:new Date(now).toISOString()},now),'reserved');
});
test('scripts parse and obsolete grid references are removed',()=>{
  for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Function(script[1]);
  assert.ok(!html.includes("getElementById('grid-"));
  assert.ok(!html.includes('DURATIONS'));
  assert.match(html,/initData: tg.initData/);
  assert.match(html,/duration_minutes: 60/);
});
test('fixed pages exclude console and cover all PCs',()=>{
  assert.equal(context.getZoneSeats('vip').length,10);
  assert.equal(context.getZoneSeats('standard').length,20);
  assert.ok(!context.getZoneSeats('standard').some(p=>p.id==='1'));
  assert.equal(context.isPhoneOnlyHost('1','ps5'),true);
  assert.equal(context.isPhoneOnlyHost('104','100'),false);
  assert.ok(!html.includes('id="floor-viewport"'));
  assert.ok(!html.includes('onclick="changeMapZoom'));
});

test("whole physical zones fit four pages without splits",()=>{
 const pages=[...context.getZonePages("vip"),...context.getZonePages("standard")];
 assert.deepEqual(Array.from(pages,p=>p.length),[10,6,8,6]);
 assert.equal(new Set(pages.flat().map(p=>p.id)).size,30);
 const zones=new Map();pages.forEach((page,i)=>page.forEach(pc=>{if(zones.has(pc.zone))assert.equal(zones.get(pc.zone),i);else zones.set(pc.zone,i)}));
});
