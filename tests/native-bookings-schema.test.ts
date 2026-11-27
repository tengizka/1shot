import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';

Deno.test('native calendar gates writes, preserves adjacent intervals, and never reclaims uncertain jobs', async () => {
 const db = new PGlite();
 try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table club_settings(id boolean primary key);
    insert into club_settings values(true);
    create table club_worker(worker_id uuid primary key,lease_until timestamptz);
    create table profiles(telegram_id bigint primary key,gizmo_user_id integer);
    insert into profiles values(1,11),(2,22);
    create table club_bookings(status text);
    create table reservations(status text,created_at timestamptz);
  `);
  await db.exec(await Deno.readTextFile('supabase/migrations/202611270001_native_bookings.sql'));
  const q = async (sql:string,args:unknown[]=[]) => (await db.query<{r:any}>(sql,args)).rows[0]?.r;
  assert.equal(await q('select booking_backend r from club_settings'), 'desk');
  await assert.rejects(db.exec("update club_settings set booking_backend='gizmo'"), /drain/);
  await db.exec("insert into club_bookings values('holding');update club_settings set booking_backend='drain'");
  await assert.rejects(db.exec("update club_settings set booking_backend='gizmo'"), /действующие/);
  await assert.rejects(db.exec("insert into reservations values('pending',now())"), /оформляются в Gizmo/);
  await db.exec("update club_bookings set status='cancelled'");
  await assert.rejects(db.exec("update club_settings set booking_backend='gizmo'"), /Нет свежего расписания/);
  const worker = crypto.randomUUID();
  await db.query("insert into club_worker values($1,now()+interval '5 minutes')",[worker]);
  async function work(op:string,data:object={},id=worker) {
   return q('select club_native_worker($1,$2,$3) r',[id,op,JSON.stringify(data)]);
  }
  await assert.rejects(work('claim',{},crypto.randomUUID()), /lease_expired/);
  const slot = Math.ceil((Date.now()+900000)/300000)*300000;
  const at = (minutes:number) => new Date(slot+minutes*60000).toISOString();
  const create = (guest:number,id:string,host:string,start:number,end:number) =>
    q('select club_native_create($1,$2,$3,$4,$5) r',[guest,id,host,at(start),at(end)]);
  const alice=crypto.randomUUID(), bob=crypto.randomUUID();
  await assert.rejects(create(1,alice,'105',0,120),/временно недоступны/);
  const snapshot = {
   observed_at:new Date(Date.now()-1000).toISOString(),
   hosts:[{host_id:'105',status:'free'},{host_id:'106',status:'busy',free_at:at(30)},{host_id:'999',status:'free'}],
   reservations:[{host_id:'105',starts_at:at(120),ends_at:at(180),gizmo_id:77,userId:99,note:'private'}],
  };
  await work('sync',snapshot);
  await db.exec("update club_settings set booking_backend='gizmo'");
  await db.exec("update club_native_schedule set observed_at=now()-interval '31 seconds'");
  await assert.rejects(create(1,alice,'105',0,120),/проверить расписание/);
  await work('sync',snapshot);
  const read = await q('select club_native_public_schedule() r');
  assert.equal(read.ready,true);
  assert.equal(read.hosts.length,2);
  assert.deepEqual(Object.keys(read.reservations[0]).sort(),['ends_at','host_id','starts_at']);
  await assert.rejects(create(1,alice,'999',0,120),/Выберите/);
  await assert.rejects(create(1,alice,'105',0,121),/Время уже занято/);
  await assert.rejects(create(1,alice,'106',0,30),/ПК недоступен/);
  assert.equal((await create(1,alice,'105',0,120)).status,'queued');
  assert.equal((await create(1,alice,'105',0,120)).id,alice);
  await assert.rejects(create(2,alice,'105',0,120),/уже использован/);
  await assert.rejects(create(1,crypto.randomUUID(),'106',30,60),/уже есть бронь/);
  await assert.rejects(create(2,bob,'105',0,30),/Время уже занято/);
  assert.equal((await work('claim')).job.id,alice);
  assert.equal((await work('claim')).job,null);
  assert.equal((await work('permit',{id:alice})).ok,true);
  await work('finish',{id:alice,status:'confirmed',gizmo_id:88});
  const cancel = (guest:number,id:string) => q('select club_native_cancel($1,$2) r',[guest,id]);
  assert.equal(await cancel(2,alice),false);
  assert.equal(await cancel(1,alice),true);
  assert.equal((await work('claim')).job.status,'cancelling');
  await work('finish',{id:alice,status:'cancelled'});
  assert.equal((await create(2,bob,'106',30,60)).status,'queued');
  assert.equal((await work('claim')).job.id,bob);
  await db.exec("update club_native_bookings set changed_at=now()-interval '91 seconds' where status='creating'");
  await work('sync',snapshot);
  assert.equal(await q('select status r from club_native_bookings where id=$1',[bob]),'review');
  assert.equal((await work('claim')).job,null);
  await db.exec("update club_settings set booking_backend='drain'");
  await assert.rejects(db.exec("update club_settings set booking_backend='desk'"), /спорные заявки/);
 } finally {await db.close()}
});
