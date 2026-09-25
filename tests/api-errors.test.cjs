const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const html=require('node:fs').readFileSync('index.html','utf8');
const code=html.slice(html.indexOf('async function apiFetch('),html.indexOf('function saveProfile('));
for (const body of [
 {error:"Could not find the 'telegram_username' column in the schema cache"},
 {message:"Could not find the 'start_time' column in the schema cache"},
 {error:{message:'Permission denied'}},
]) {
 test('preserves actual error: '+JSON.stringify(body),async()=>{
  const ctx=vm.createContext({fetch:async()=>({ok:false,status:400,text:async()=>JSON.stringify(body)})});
  vm.runInContext(code,ctx);
  await assert.rejects(ctx.apiFetch('/test'),e=>e.message.includes(typeof body.error==='string'?body.error:body.message||body.error.message));
 });
}
test('does not remap all schema errors to duration_minutes',()=>{
 assert.ok(!html.includes('/duration_minutes|schema cache/i'));
});

test('provider name is neutralized in service messages without altering payloads',async()=>{
 const ctx=vm.createContext({fetch:async()=>({ok:false,status:409,text:async()=>JSON.stringify({error:'Gizmo недоступен'})})});vm.runInContext(code,ctx);
 await assert.rejects(ctx.apiFetch('/test'),e=>e.message==='HTTP 409: сервис клуба недоступен');
 assert.equal(ctx.clubText('Проверено в GIZMO'),'Проверено в системе клуба');
});
