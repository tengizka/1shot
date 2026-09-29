const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('vm'),fs=require('fs');
const ctx=vm.createContext({Date});vm.runInContext(fs.readFileSync('arrival-time.js','utf8'),ctx);
test('Moscow midnight labels tomorrow and year rollover, independent of browser timezone',()=>{
 const now=Date.parse('2026-12-31T23:55:00+03:00');const at=ctx.nextClubArrival(0,0,now);
 assert.equal(at,'2026-12-31T21:00:00.000Z');assert.equal(ctx.clubArrivalLabel(at,now),'Завтра, 00:00 МСК');assert.equal(ctx.clubDateInput(at),'2027-01-01T00:00');
});
test('future time stays today; past time chooses next occurrence',()=>{
 const now=Date.parse('2026-09-29T12:00:00+03:00');assert.equal(ctx.clubArrivalLabel(ctx.nextClubArrival(12,15,now),now),'Сегодня, 12:15 МСК');assert.equal(ctx.clubArrivalLabel(ctx.nextClubArrival(11,0,now),now),'Завтра, 11:00 МСК');
});
