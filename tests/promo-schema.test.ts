import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('promo codes: validated on submit, tracked through approval, rewarded once',async()=>{
 const db=new PGlite();const check=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)};
 const fail=async(fn:()=>Promise<unknown>,text='')=>{try{await fn()}catch(e){if(text&&!String((e as Error).message).includes(text))throw e;return}throw Error('expected rejection')};
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(telegram_id bigint primary key,gizmo_user_id integer,username text,first_name text,last_name text);
 create table club_worker(worker_id uuid primary key,lease_until timestamptz);
 create table club_auth_requests(id uuid primary key,status text,created_at timestamptz default now());
 create function club_worker_poll(p_worker uuid,p_after bigint,p_hosts jsonb,p_accounts jsonb) returns jsonb language sql as $$select '{"desk":{}}'::jsonb$$;`);
 await db.exec(await Deno.readTextFile('supabase/migrations/202610080014_registration_approval.sql'));
 await db.exec(await Deno.readTextFile('supabase/migrations/202610230019_promo_codes.sql'));
 const worker=crypto.randomUUID();await db.query("insert into club_worker values($1,now()+interval '1 minute')",[worker]);
 const data=(promo?:string)=>JSON.stringify({username:'guest',first_name:'A',last_name:'B',mobile_phone:'+79990000000',birth_date:'2000-01-01',sex:1,password:'secret',...(promo===undefined?{}:{promo_code:promo})});
 const submit=(user:number,promo?:string,id=crypto.randomUUID())=>db.query<{v:string}>('select club_registration_submit($1,$2,$3,$4) v',[id,user,data(promo),'cipher']);

 await fail(()=>submit(1,'NOPE'),'Промокод не найден');
 check((await db.query<{n:number}>('select count(*)::int n from club_registration_requests')).rows[0].n===0,'bad code must not create a request');
 await db.exec("update club_promo_codes set active=false where code='YMAPS'");await fail(()=>submit(1,'YMAPS'),'Промокод не найден');

 const a=(await submit(1,' vk ')).rows[0].v;
 const pub=(await db.query<{p:Record<string,unknown>}>('select public_data p from club_registration_requests where id=$1',[a])).rows[0].p;
 check(pub.promo_code==='VK'&&!('password' in pub),'public summary keeps the normalized code and never the password');
 check((await db.query<{s:string}>('select status s from club_promo_redemptions where registration_id=$1',[a])).rows[0].s==='awaiting_admin');
 check((await submit(1,'YANDEX')).rows[0].v===a,'an active application is returned unchanged');
 check((await db.query<{n:number}>('select count(*)::int n from club_promo_redemptions')).rows[0].n===1);

 const b=(await submit(2)).rows[0].v;
 check(!('promo_code' in (await db.query<{p:Record<string,unknown>}>('select public_data p from club_registration_requests where id=$1',[b])).rows[0].p),'no code, no field');

 check(!(await db.query<{v:boolean}>("select club_promo_reward($1,$2,'granted') v",[worker,a])).rows[0].v,'no reward before approval');
 await db.query('select club_registration_claim($1,$2,true)',[worker,a]);
 check((await db.query<{s:string}>('select status s from club_promo_redemptions where registration_id=$1',[a])).rows[0].s==='processing');
 await db.query("select club_registration_finish($1,$2,'done',77)",[worker,a]);
 const done=(await db.query<{s:string,u:number,d:string}>('select status s,gizmo_user_id u,decided_at d from club_promo_redemptions where registration_id=$1',[a])).rows[0];
 check(done.s==='done'&&done.u===77&&done.d,'approval is mirrored with the Gizmo id');

 const reward=(r:string)=>db.query<{v:boolean}>('select club_promo_reward($1,$2,$3) v',[worker,a,r]).then(x=>x.rows[0].v);
 check(await reward('granted'));check(await reward('granted'),'same report is idempotent');check(!(await reward('failed')),'result cannot change');
 await fail(()=>reward('maybe'),'invalid_reward');
 await db.query("update club_worker set lease_until=now()-interval '1 second'");await fail(()=>reward('granted'),'worker_lease_expired');

 await db.query("update club_registration_requests set updated_at=now()-interval '8 days'");await db.query('select club_registration_cleanup()');
 check((await db.query<{n:number}>("select count(*)::int n from club_promo_redemptions where code='VK' and reward='granted'")).rows[0].n===1,'stats survive request cleanup');

 await db.exec('set role anon');await fail(()=>db.query('select * from club_promo_codes'));await fail(()=>db.query('select * from club_promo_redemptions'));
 }finally{await db.close()}
});
