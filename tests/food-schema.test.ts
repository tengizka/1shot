import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
Deno.test('food: menu from Desk, order only while seated, prices from the menu, status only forward',async()=>{
 const db=new PGlite();const check=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)};
 const fail=async(fn:()=>Promise<unknown>,text='')=>{try{await fn()}catch(e){if(text&&!String((e as Error).message).includes(text))throw e;return}throw Error('expected rejection')};
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table profiles(telegram_id bigint primary key,gizmo_user_id integer,username text,first_name text,last_name text);
 create table club_worker(worker_id uuid primary key,lease_until timestamptz);`);
 await db.exec(await Deno.readTextFile('supabase/migrations/202610240023_food_orders.sql'));await db.exec(await Deno.readTextFile('supabase/migrations/202610240024_food_seats_where.sql'));
 const worker=crypto.randomUUID();await db.query("insert into club_worker values($1,now()+interval '1 minute')",[worker]);
 await db.exec("insert into profiles values(1,77,'neo','Нео','А'),(2,null,'new','Н','Б')");
 type Row=Record<string,unknown>;
 const sync=(seats:unknown,menu:unknown=null,updates:unknown=[])=>db.query<{v:Row}>('select club_food_sync($1,$2,$3,$4) v',[worker,seats===null?null:JSON.stringify(seats),menu===null?null:JSON.stringify(menu),JSON.stringify(updates)]).then(r=>r.rows[0].v);
 const order=(user:number,items:unknown,payment='card',request=crypto.randomUUID())=>db.query<{v:Row}>('select club_food_order($1,$2,$3,$4) v',[user,request,JSON.stringify(items),payment]).then(r=>r.rows[0].v);
 const state=(user:number,menu=true)=>db.query<{v:Row}>('select club_food_state($1,$2) v',[user,menu]).then(r=>r.rows[0].v);

 await sync([],[{id:10,group:'Напитки',name:'Red Bull',price:189,sort:1},{id:11,group:'Снеки',name:'Lays',price:120,image:'data:image/webp;base64,AA=='}]);
 let s=await state(1);check((s.menu as Row[]).length===2&&s.seat===null&&s.account===true&&s.desk===true,'menu visible, not seated');
 await fail(()=>order(1,[{id:10,qty:1}]),'сидите за ПК');
 await fail(()=>order(2,[{id:10,qty:1}]),'войдите');

 await sync([{uid:77,host:'13'}]);
 s=await state(1);check(s.seat==='13','seat from the Desk snapshot');
 await fail(()=>order(1,[{id:10,qty:6}]),'До 5');
 await fail(()=>order(1,[{id:10,qty:2.5}]),'До 5');
 await fail(()=>order(1,['x']),'До 5');
 await fail(()=>order(1,[{id:10,qty:1},{id:10,qty:1}]),'повторяются');
 await fail(()=>order(1,[{id:99,qty:1}]),'Меню обновилось');
 await fail(()=>order(1,[{id:10,qty:1}],'free'),'способ оплаты');
 await fail(()=>order(1,[]),'от 1 до 10');

 const req=crypto.randomUUID();
 const o=await order(1,[{id:10,qty:2,price:1},{id:11,qty:1}],'deposit',req);
 check(Number(o.total)===498&&o.status==='new'&&o.host_id==='13','price from the menu, not the client');
 check((await order(1,[{id:10,qty:1}],'cash',req)).id===o.id,'same request id returns the same order');
 await fail(()=>order(1,[{id:11,qty:1}]),'Прошлый заказ');

 let open=(await sync([{uid:77,host:'13'}],null,[{id:o.id,status:'sent',assistance_id:500}])).orders as Row[];
 check(open.length===1&&open[0].status==='sent'&&open[0].assistance_id===500,'Desk sees its open order');
 await sync([{uid:77,host:'13'}],null,[{id:o.id,status:'new'}]);
 check(((await state(1)).orders as Row[])[0].status==='sent','status never moves back');
 await sync([{uid:77,host:'13'}],null,[{id:o.id,status:'cancelled'}]);
 await sync([{uid:77,host:'13'}],null,[{id:o.id,status:'accepted'}]);
 const second=await order(1,[{id:11,qty:1}]);check(second.status==='new','accepted order does not block the next one');
 open=(await sync([{uid:77,host:'13'}],null,[{id:o.id,status:'closed',message:'Закрыт'}])).orders as Row[];
 check(open.length===1&&open[0].id===second.id,'closed orders leave the Desk queue');

 await sync([{uid:77,host:'13'}],[{id:11,group:'Снеки',name:'Lays',price:130}]);
 check(((await state(1)).menu as Row[]).length===1,'removed products leave the menu');check((await state(1,false)).menu===null&&String((await state(1,false)).menu_version).endsWith('-1'),'status poll carries no pictures');
 await db.exec("update club_food_seats set seen_at=now()-interval '2 minutes'");check((await state(1)).seat===null,'stale seat');
 await db.query("update club_worker set lease_until=now()-interval '1 second'");await fail(()=>sync([]),'worker_lease_expired');
 await db.query("update club_food_orders set status='new',created_at=now()-interval '30 minutes'");
 await db.query("update club_worker set lease_until=now()+interval '1 minute'");await sync([{uid:77,host:'13'}]);
 check((await order(1,[{id:11,qty:1}])).status==='new','an order stuck for 20 minutes does not block forever');

 await db.exec('set role anon');await fail(()=>db.query('select * from club_food_orders'));await fail(()=>db.query('select * from club_food_seats'));await fail(()=>db.query('select club_food_state(1)'));
 }finally{await db.close()}
});
