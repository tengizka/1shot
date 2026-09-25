import { createClient } from 'npm:@supabase/supabase-js@2.7.1';
const headers = {'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, OPTIONS',
  'Content-Type':'application/json','Cache-Control':'no-store'};
const json = (value: unknown, status=200) => new Response(JSON.stringify(value),{status,headers});
Deno.serve(async req => {
  if (req.method==='OPTIONS') return new Response(null,{headers});
  if (req.method!=='GET') return json({error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({error:'hosts_server_not_configured'},500);
  // Read on the trusted server, NOT as anon: RLS may silently hide all rows
  // from anon. Never put the service role key in index.html.
  const supabase=createClient(url,key);
  const {data,error}=await supabase.from('hosts_cache')
    .select('host_id,zone,status,gizmo_host_id,updated_at').order('host_id');
  if (error) {
    console.error('hosts_cache read failed:',error.code);
    return json({error:'hosts_cache_read_failed'},500);
  }
  return json({hosts:data || [],diagnostic:data?.length ? null : 'hosts_cache_empty'});
});
