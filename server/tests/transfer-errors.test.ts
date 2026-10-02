Deno.test('invalid transfer URLs never expose credentials in stderr',async()=>{
 // Synthetic values only. The malformed hash forces URL parsing to fail before
 // any network connection. Run the actual CLI, not a mocked error formatter.
 for(const action of ['export','import']){
  const secret='SYNTHETIC-do-not-log#broken';
  const result=await new Deno.Command(Deno.execPath(),{
   args:['run','--allow-env','--allow-read','server/tools/transfer.ts',action,'unused.json'],
   env:{SOURCE_DATABASE_URL:`postgresql://test:${secret}@localhost/test`,LOCAL_ADMIN_DATABASE_URL:`postgresql://test:${secret}@localhost/test`,CONFIRM_LOCAL_IMPORT:'YES'},
   stdout:'piped',stderr:'piped',
  }).output();
  const output=new TextDecoder().decode(result.stdout)+new TextDecoder().decode(result.stderr);
  if(result.success||!output.includes('Transfer failed.')||output.includes(secret)||output.includes('postgresql://'))throw Error('CLI must fail without printing credentials');
 }
});
