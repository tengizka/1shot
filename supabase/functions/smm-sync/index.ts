// SMM dashboard sync: Yandex Metrica (landing visits by ?p= code), VK Ads and Yandex Direct (spend, clicks).
// Runs hourly from pg_cron (x-sync-secret) and on demand from the dashboard for admins (user JWT).
// A source without its secrets is skipped and marked "не подключено"; one failing source never blocks the others.
import {createClient} from 'npm:@supabase/supabase-js@2.45.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-sync-secret','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const env=(k:string)=>(Deno.env.get(k)||'').trim();
type Db=ReturnType<typeof createClient>;

const iso=(d:Date)=>d.toISOString().slice(0,10);
function period(days=14){const to=new Date(Date.now()+3*3600e3);const from=new Date(to.getTime()-(days-1)*86400e3);return {from:iso(from),to:iso(to)};}

async function status(c:Db,source:string,ok:boolean,message:string){
 await c.from('smm_sync_status').upsert({source,ok,message:message.slice(0,300),updated_at:new Date().toISOString()});
}
async function overrides(c:Db,source:string){
 const {data}=await c.from('smm_campaign_codes').select('campaign_id,code').eq('source',source);
 return new Map((data||[]).map((r:{campaign_id:string,code:string})=>[r.campaign_id,r.code]));
}
async function saveAds(c:Db,source:'vk'|'direct',from:string,to:string,rows:Record<string,unknown>[]){
 const {error:e1}=await c.from('smm_ad_daily').delete().eq('source',source).gte('day',from).lte('day',to);if(e1)throw e1;
 for(let i=0;i<rows.length;i+=500){const {error}=await c.from('smm_ad_daily').insert(rows.slice(i,i+500));if(error)throw error;}
}

async function metrika(c:Db,from:string,to:string){
 // Token from function secrets, or from Vault (smm_metrika_token, read via smm_secret).
 const token=env('METRIKA_TOKEN')||String((await c.rpc('smm_secret',{p_name:'smm_metrika_token'})).data||'');if(!token)return 'не подключено: нет METRIKA_TOKEN';
 const id=env('METRIKA_COUNTER')||'113969406',goal=env('METRIKA_GOAL')||'677348955';
 const u=new URL('https://api-metrika.yandex.net/stat/v1/data');
 u.search=new URLSearchParams({ids:id,metrics:`ym:s:visits,ym:s:goal${goal}reaches`,dimensions:'ym:s:date,ym:s:startURL',date1:from,date2:to,limit:'100000',accuracy:'full'}).toString();
 const r=await fetch(u,{headers:{Authorization:'OAuth '+token}});
 if(!r.ok)throw Error(`Метрика HTTP ${r.status}: ${(await r.text()).slice(0,160)}`);
 const j=await r.json();const agg=new Map<string,{day:string,code:string,visits:number,bot_opens:number}>();
 for(const row of j.data||[]){
  const day=row.dimensions?.[0]?.name;if(!day)continue;let code='GG';
  try{const p=new URL(row.dimensions[1].name).searchParams.get('p');if(p&&/^[A-Za-z0-9_-]{2,32}$/.test(p))code=p.toUpperCase();}catch{/* not a URL: count as GG */}
  const k=day+'|'+code,a=agg.get(k)||{day,code,visits:0,bot_opens:0};a.visits+=Number(row.metrics?.[0]||0);a.bot_opens+=Number(row.metrics?.[1]||0);agg.set(k,a);
 }
 const rows=[...agg.values()].map(a=>({...a,visits:Math.round(a.visits),bot_opens:Math.round(a.bot_opens),updated_at:new Date().toISOString()}));
 const {error:e1}=await c.from('smm_site_daily').delete().gte('day',from).lte('day',to);if(e1)throw e1;
 if(rows.length){const {error}=await c.from('smm_site_daily').insert(rows);if(error)throw error;}
 return `ок: ${rows.reduce((s,r)=>s+r.visits,0)} визитов`;
}

async function vkToken(c:Db){
 if(env('VK_ADS_TOKEN'))return env('VK_ADS_TOKEN');
 const id=env('VK_ADS_CLIENT_ID'),secret=env('VK_ADS_CLIENT_SECRET');if(!id||!secret)return null;
 const {data}=await c.from('smm_tokens').select('*').eq('source','vk').maybeSingle();
 if(data?.access_token&&data.expires_at&&new Date(data.expires_at).getTime()>Date.now()+600e3)return data.access_token as string;
 // VK Ads limits live tokens per client, so refresh the stored one instead of issuing new ones.
 const ask=(body:Record<string,string>)=>fetch('https://ads.vk.ru/api/v2/oauth2/token.json',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
 let r=data?.refresh_token?await ask({grant_type:'refresh_token',refresh_token:data.refresh_token,client_id:id,client_secret:secret}):null;
 if(!r||!r.ok)r=await ask({grant_type:'client_credentials',client_id:id,client_secret:secret});
 const t=await r.json();
 if(!t.access_token)throw Error('VK Ads токен: '+JSON.stringify(t).slice(0,160));
 await c.from('smm_tokens').upsert({source:'vk',access_token:t.access_token,refresh_token:t.refresh_token||data?.refresh_token||null,expires_at:new Date(Date.now()+Number(t.expires_in||86400)*1000).toISOString()});
 return t.access_token as string;
}
async function vk(c:Db,from:string,to:string){
 const token=await vkToken(c);if(!token)return 'не подключено: нет VK_ADS_CLIENT_ID/VK_ADS_CLIENT_SECRET';
 const get=async(path:string,q:Record<string,string>)=>{const u=new URL('https://ads.vk.ru/api/v2/'+path);u.search=new URLSearchParams(q).toString();const r=await fetch(u,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error(`VK Ads HTTP ${r.status}: ${(await r.text()).slice(0,160)}`);return r.json();};
 const plans=await get('ad_plans.json',{fields:'id,name,status',limit:'250'});
 const names=new Map<string,string>((plans.items||[]).map((p:{id:number,name:string})=>[String(p.id),p.name]));
 const map=await overrides(c,'vk');const rows:Record<string,unknown>[]=[];
 if(names.size){
  const st=await get('statistics/ad_plans/day.json',{id:[...names.keys()].join(','),date_from:from,date_to:to,metrics:'base'});
  for(const item of st.items||[])for(const row of item.rows||[]){
   const b=row.base||{};const shows=Number(b.shows||0),clicks=Number(b.clicks||0),spent=Number(b.spent||0);
   if(!shows&&!clicks&&!spent)continue;const cid=String(item.id);
   rows.push({day:row.date,source:'vk',campaign_id:cid,campaign_name:names.get(cid)||null,code:map.get(cid)||'HEADSHOT',impressions:shows,clicks,spend:spent,updated_at:new Date().toISOString()});
  }
 }
 await saveAds(c,'vk',from,to,rows);
 return `ок: ${names.size} кампаний`;
}

async function direct(c:Db,from:string,to:string){
 const token=env('DIRECT_TOKEN');if(!token)return 'не подключено: нет DIRECT_TOKEN';
 const headers:Record<string,string>={Authorization:'Bearer '+token,'Accept-Language':'ru',processingMode:'auto',returnMoneyInMicros:'false',skipReportHeader:'true',skipReportSummary:'true','Content-Type':'application/json'};
 if(env('DIRECT_CLIENT_LOGIN'))headers['Client-Login']=env('DIRECT_CLIENT_LOGIN');
 const body={params:{SelectionCriteria:{DateFrom:from,DateTo:to},FieldNames:['Date','CampaignId','CampaignName','Impressions','Clicks','Cost'],ReportName:`1shot ${from} ${to} ${Date.now()}`,ReportType:'CAMPAIGN_PERFORMANCE_REPORT',DateRangeType:'CUSTOM_DATE',Format:'TSV',IncludeVAT:'YES'}};
 const r=await fetch('https://api.direct.yandex.com/json/v5/reports',{method:'POST',headers,body:JSON.stringify(body)});
 if(r.status===201||r.status===202)return 'отчёт Директа готовится, данные будут при следующем обновлении';
 const text=await r.text();
 if(!r.ok)throw Error(`Директ HTTP ${r.status}: ${text.slice(0,160)}`);
 const lines=text.trim().split('\n');const head=(lines.shift()||'').split('\t');const ix=(n:string)=>head.indexOf(n);
 const map=await overrides(c,'direct');const rows:Record<string,unknown>[]=[];
 for(const l of lines){
  const f=l.split('\t');if(f.length<head.length)continue;const cid=f[ix('CampaignId')],name=f[ix('CampaignName')];
  const code=map.get(cid)||(/карт|maps|respawn/i.test(name)?'RESPAWN':'LEVELUP');
  rows.push({day:f[ix('Date')],source:'direct',campaign_id:cid,campaign_name:name,code,impressions:Number(f[ix('Impressions')])||0,clicks:Number(f[ix('Clicks')])||0,spend:Number(f[ix('Cost')])||0,updated_at:new Date().toISOString()});
 }
 await saveAds(c,'direct',from,to,rows);
 return `ок: ${new Set(rows.map(r=>r.campaign_id)).size} кампаний`;
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const c=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
 // The cron secret lives in Vault (migration 202611010033); SMM_SYNC_SECRET can override it.
 const sent=req.headers.get('x-sync-secret')||'';
 let allowed=false;
 if(sent){const secret=env('SMM_SYNC_SECRET')||String((await c.rpc('smm_cron_secret')).data||'');allowed=secret.length>=32&&sent===secret;}
 if(!allowed){
  // An admin of the dashboard may press "Обновить": check the role with the caller's own JWT.
  const auth=req.headers.get('authorization')||'';
  if(auth.startsWith('Bearer ')){
   const user=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:auth}}});
   const {data}=await user.rpc('smm_role');allowed=data==='admin';
  }
 }
 if(!allowed)return json({error:'Unauthorized'},403);
 const {from,to}=period(14);const result:Record<string,string>={};
 for(const [name,fn] of [['metrika',metrika],['vk',vk],['direct',direct]] as const){
  try{const msg=await fn(c,from,to);result[name]=msg;await status(c,name,!msg.startsWith('не подключено'),msg);}
  catch(e){const msg=String((e as Error).message||e);result[name]='ошибка: '+msg;await status(c,name,false,'ошибка: '+msg);}
 }
 return json({ok:true,from,to,result});
});
