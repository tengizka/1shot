/** Small, parameterized PostgreSQL adapter. No hosted services or REST DB gateway. */
export type Runner = (query: string, args?: unknown[]) => Promise<Record<string, any>[]>;
let run: Runner;
export function configureDatabase(runner: Runner) { run = runner; }
const tables = new Set(['profiles','hosts_cache','club_settings','club_worker','club_bookings','club_events','club_accounts','club_commands','club_auth_requests']);
const functions = new Set(['club_worker_poll','club_worker_lease','club_worker_transition','club_password_review','club_password_resolve','club_password_context','club_password_authorize','club_password_status','club_password_submit','club_password_claim','club_password_finish','club_auth_claim','club_auth_enqueue','club_registration_submit','club_registration_status','club_registration_claim','club_registration_reject','club_registration_finish','club_registration_review','club_registration_reconcile','club_client_state','club_create_v2','club_booking_action','club_account_request','club_command','club_create_booking','club_checkin','club_cancel','club_admin_booking','club_admin_cancel']);
const ident = (s: string) => { if(!/^[a-z_][a-z0-9_]*$/.test(s)) throw Error('invalid_identifier'); return '"'+s+'"'; };
const failure = (e: any) => ({data:null,error:{code:e.code || 'LOCAL_DB',message:e.code==='P0001'?String(e.message):'database_error'}});
class Query implements PromiseLike<any> {
 private args: unknown[]=[]; private where: string[]=[]; private fields='*'; private orders: string[]=[];
 private maximum: number|null=null; private one=false; private row: Record<string,unknown>|null=null; private conflict: string|null=null;
 private writing=false; private returning=false;
 constructor(private table: string) { if(!tables.has(table))throw Error('table_not_allowed'); }
 private param(v: unknown){this.args.push(v);return '$'+this.args.length;}
 select(fields='*'){this.fields=fields==='*'?'*':fields.split(',').map(ident).join(',');if(this.writing)this.returning=true;return this;}
 update(row: Record<string,unknown>){this.row=row;this.writing=true;return this;}
 upsert(row: Record<string,unknown>, opts:{onConflict:string}){this.row=row;this.writing=true;this.conflict=ident(opts.onConflict);return this;}
 eq(k:string,v:unknown){this.where.push(`${ident(k)} = ${this.param(v)}`);return this;}
 gt(k:string,v:unknown){this.where.push(`${ident(k)} > ${this.param(v)}`);return this;}
 in(k:string,values:unknown[]){this.where.push(values.length?`${ident(k)} IN (${values.map(v=>this.param(v)).join(',')})`:'false');return this;}
 not(k:string,op:string,v:string){if(op!=='in'||!/^\([a-z_,]+\)$/.test(v))throw Error('unsupported_filter');this.where.push(`${ident(k)} NOT IN (${v.slice(1,-1).split(',').map(x=>this.param(x)).join(',')})`);return this;}
 order(k:string,opts:{ascending?:boolean,nullsFirst?:boolean}={}){this.orders.push(`${ident(k)} ${opts.ascending===false?'DESC':'ASC'}${opts.nullsFirst===undefined?'':opts.nullsFirst?' NULLS FIRST':' NULLS LAST'}`);return this;}
 limit(n:number){if(!Number.isInteger(n)||n<0||n>1000)throw Error('invalid_limit');this.maximum=n;return this;}
 single(){this.one=true;return this;}
 private async execute(){
  try {
   let sql: string;const table='public.'+ident(this.table);
   if(this.row){
    const keys=Object.keys(this.row);if(!keys.length)throw Error('empty_write');
    if(this.conflict){sql=`INSERT INTO ${table} (${keys.map(ident)}) VALUES (${keys.map(k=>this.param(this.row![k]))}) ON CONFLICT (${this.conflict}) DO UPDATE SET ${keys.map(k=>`${ident(k)}=excluded.${ident(k)}`).join(',')}`;}
    else {if(!this.where.length)throw Error('unfiltered_update');sql=`UPDATE ${table} SET ${keys.map(k=>`${ident(k)}=${this.param(this.row![k])}`).join(',')} WHERE ${this.where.join(' AND ')}`;}
    if(this.returning)sql+=' RETURNING '+this.fields;
   }else {sql=`SELECT ${this.fields} FROM ${table}`;if(this.where.length)sql+=' WHERE '+this.where.join(' AND ');if(this.orders.length)sql+=' ORDER BY '+this.orders.join(',');if(this.maximum!==null)sql+=' LIMIT '+this.maximum;}
   const rows=await run(sql,this.args);
   if(this.one&&rows.length!==1)return {data:null,error:{code:'NOT_SINGLE',message:'row_not_found'}};
   return {data:this.one?rows[0]:this.writing&&!this.returning?null:rows,error:null};
  }catch(e){return failure(e);}
 }
 then<TResult1=any,TResult2=never>(resolve?:((v:any)=>TResult1|PromiseLike<TResult1>)|null,reject?:((e:any)=>TResult2|PromiseLike<TResult2>)|null):PromiseLike<TResult1|TResult2>{return this.execute().then(resolve,reject);}
}
export const db=()=>({
 from:(table:string)=>new Query(table),
 rpc:async(name:string,args:Record<string,unknown>={})=>{
  try{
   if(!functions.has(name))throw Error('function_not_allowed');
   // postgres.js serializes json/jsonb using the parameter type from PostgreSQL.
   // Do not stringify here: that would encode arrays/objects as JSON strings.
   const values=Object.values(args);
   const call=`public.${ident(name)}(${Object.keys(args).map((k,i)=>`${ident(k)} => $${i+1}`).join(',')})`;
   const rows=await run(`SELECT to_jsonb(result) AS value FROM ${call} AS result`,values);
   return {data:name==='club_auth_claim'?rows.map(r=>r.value):rows[0]?.value??null,error:null};
  }catch(e){return failure(e);}
 }
});
