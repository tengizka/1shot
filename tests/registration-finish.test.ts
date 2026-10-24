import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('registration: unlinked profile, finish after timeout, guest cancel',async()=>{
 const db=new PGlite();const check=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)};
 const fail=async(fn:()=>Promise<unknown>,text='')=>{try{await fn()}catch(e){if(text&&!String((e as Error).message).includes(text))throw e;return}throw Error('expected rejection')};
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(telegram_id bigint primary key,gizmo_user_id integer,username text,first_name text,last_name text);
 create table club_worker(worker_id uuid primary key,lease_until timestamptz);
 create table club_auth_requests(id uuid primary key,status text,created_at timestamptz default now());
 create function club_worker_poll(p_worker uuid,p_after bigint,p_hosts jsonb,p_accounts jsonb) returns jsonb language sql as $$select '{"desk":{}}'::jsonb$$;`);
 for(const f of ['202610080014_registration_approval','202610230019_promo_codes','202610240026_registration_finish_cancel'])await db.exec(await Deno.readTextFile(`supabase/migrations/${f}.sql`));
 const worker=crypto.randomUUID();await db.query("insert into club_worker values($1,now()+interval '1 minute')",[worker]);
 const data=JSON.stringify({username:'guest',first_name:'A',last_name:'B',mobile_phone:'+79990000000',birth_date:'2000-01-01',sex:1,password:'x',promo_code:'HEADSHOT'});
 const submit=(user:number)=>db.query<{v:string}>('select club_registration_submit($1,$2,$3,$4) v',[crypto.randomUUID(),user,data,'cipher']).then(r=>r.rows[0].v);
 const status=(id:string)=>db.query<{s:string,u:number}>('select status s,gizmo_user_id u from club_registration_requests where id=$1',[id]).then(r=>r.rows[0]);

 // Account deleted in Gizmo: the profile was set to 0 and must not block the next one.
 await db.exec("insert into profiles values(5,0,'old','O','L')");
 const a=await submit(5);await db.query('select club_registration_claim($1,$2,true)',[worker,a]);
 await db.query("update club_registration_requests set status='attention' where id=$1",[a]);
 check((await db.query<{v:boolean}>("select club_registration_finish($1,$2,'done',42) v",[worker,a])).rows[0].v,'finish after the timeout');
 check((await status(a)).s==='done');check((await db.query<{u:number}>('select gizmo_user_id u from profiles where telegram_id=5')).rows[0].u===42);
 check((await db.query<{s:string}>('select status s from club_promo_redemptions where registration_id=$1',[a])).rows[0].s==='done','promo mirrored');

 // A Telegram with an account may apply again: the admin sees which account is linked, the new one takes over.
 await db.exec("insert into profiles values(6,77,'oldnick','X','Y')");
 const b=await submit(6);
 const pub=(await db.query<{p:Record<string,unknown>}>('select public_data p from club_registration_requests where id=$1',[b])).rows[0].p;
 check(JSON.stringify(pub.linked_account)==='{"username":"oldnick","gizmo_user_id":77}','admin sees the linked account');
 await db.query('select club_registration_claim($1,$2,true)',[worker,b]);await db.query("select club_registration_finish($1,$2,'done',88)",[worker,b]);
 check((await db.query<{u:number}>('select gizmo_user_id u from profiles where telegram_id=6')).rows[0].u===88,'the new account is linked');
 // The free hour stays one per Telegram.
 await fail(()=>submit(5),'бесплатный час уже получали');

 // Guest cancels a waiting application; a processing one is the admin's.
 const c=await submit(7);check((await db.query<{v:boolean}>('select club_registration_cancel(7) v')).rows[0].v);
 const gone=await db.query<{s:string,p:Record<string,unknown>,c:string|null}>('select status s,public_data p,cipher c from club_registration_requests where id=$1',[c]);
 check(gone.rows[0].s==='rejected'&&Object.keys(gone.rows[0].p).length===0&&gone.rows[0].c===null,'data removed');
 const d=await submit(7);await db.query('select club_registration_claim($1,$2,true)',[worker,d]);
 await fail(()=>db.query('select club_registration_cancel(7)'),'администратор');
 await db.exec('set role anon');await fail(()=>db.query('select club_registration_cancel(7)'));
 }finally{await db.close()}
});
