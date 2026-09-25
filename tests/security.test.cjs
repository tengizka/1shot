const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('legacy agent has no embedded connection credentials',()=>{
 const source=fs.readFileSync('agent.py','utf8');
 for(const key of ['GIZMO_BASE_URL','GIZMO_LOGIN','GIZMO_PASSWORD','SUPABASE_URL','AGENT_SECRET']){
  assert.match(source,new RegExp('^'+key+' = os.environ.get\\("'+key+'", ""\\)','m'));
 }
 assert.match(source,/if missing:/);assert.match(fs.readFileSync('.gitignore','utf8'),/^\.env$/m);
});
