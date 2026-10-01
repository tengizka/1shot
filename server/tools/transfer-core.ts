import type {Runner} from '../database.ts';
export const TABLES=['profiles','hosts_cache','reservations','club_settings','club_bookings','club_events','club_accounts','club_commands','club_auth_requests'] as const;
export type Bundle={format:'1shot-local-v1',exported_at:string,tables:Record<string,Record<string,unknown>[]>};
export async function exportBundle(run:Runner):Promise<Bundle>{
 const live=await run('select lease_until > now() as live from public.club_worker where id=true');
 if(live[0]?.live)throw Error('Stop Desk and wait for lease expiration before exporting');
 const active=await run("select (select count(*) from club_commands where status in ('queued','running')) + (select count(*) from club_auth_requests where status in ('pending','running')) as n");
 if(Number(active[0].n))throw Error('Unfinished commands/auth: resolve them before export; never replay unknown writes');
 const tables:Bundle['tables']={};
 for(const table of TABLES)tables[table]=await run(`select * from public.${table}`);
 // Finished authentication does not need its encrypted password payload anymore.
 for(const row of tables.club_auth_requests)row.cipher=null;
 return {format:'1shot-local-v1',exported_at:new Date().toISOString(),tables};
}
export async function importBundle(run:Runner,bundle:Bundle){
 if(bundle.format!=='1shot-local-v1'||!bundle.tables||TABLES.some(t=>!Array.isArray(bundle.tables[t]))||Object.keys(bundle.tables).some(t=>!TABLES.includes(t as any)))throw Error('Invalid backup format');
 if(bundle.tables.club_commands.some(r=>['queued','running'].includes(String(r.status)))||bundle.tables.club_auth_requests.some(r=>['pending','running'].includes(String(r.status))||r.cipher))throw Error('Unfinished operations or credentials in backup');
 const live=await run('select lease_until > now() as live from public.club_worker where id=true');if(live[0]?.live)throw Error('Local Desk must be stopped');
 for(const table of TABLES.filter(t=>t!=='club_settings')){const rows=await run(`select count(*) as n from public.${table}`);if(Number(rows[0].n))throw Error('Destination must be empty: '+table);}
 const warnings:string[]=[];
 await run('delete from public.club_settings');
 for(const table of TABLES){
  const columns=(await run('select column_name from information_schema.columns where table_schema=\'public\' and table_name=$1 order by ordinal_position',[table])).map(r=>String(r.column_name));
  const rows=bundle.tables[table];
  const extras=new Set(rows.flatMap(r=>Object.keys(r).filter(k=>!columns.includes(k))));
  if(extras.size)warnings.push(table+': additional source fields retained in backup only: '+[...extras].join(', '));
  // Group equal column sets so absent optional fields get local database defaults.
  const groups=new Map<string,Record<string,unknown>[]>();
  for(const row of rows){const keys=columns.filter(k=>Object.hasOwn(row,k));if(!keys.length)throw Error('Empty row');const key=keys.join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(row);}
  for(const [key,group] of groups){const quoted=key.split(',').map(k=>'"'+k+'"').join(',');
   for(let offset=0;offset<group.length;offset+=250)await run(`insert into public.${table} (${quoted}) overriding system value select ${quoted} from jsonb_populate_recordset(null::public.${table},$1::jsonb)`,[JSON.stringify(group.slice(offset,offset+250))]);
  }
  const count=Number((await run(`select count(*) as n from public.${table}`))[0].n);if(count!==rows.length)throw Error('Row count mismatch: '+table);
 }
 if(bundle.tables.club_settings.length!==1)throw Error('Missing club settings');
 await run("select setval(pg_get_serial_sequence('public.club_events','id'),coalesce(max(id),1),max(id) is not null) from public.club_events");
 await run('update public.club_worker set worker_id=null,lease_until=null,protocol=2');
 await run('update public.hosts_cache set updated_at=null');
 await run('update public.club_settings set enabled=false,flow_version=2');
 return warnings;
}
