# Safe read-only database diagnostics, also works with older container images.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$temp = $null
try {
    if (-not (Test-Path '.\compose.yaml') -or -not (Test-Path '.\private\transfer.env')) {
        Write-Host 'Put this script in the installed server folder containing private/transfer.env.'
        exit 1
    }
    $directory = Join-Path $PSScriptRoot 'private'
    $name = 'diagnostic-' + [guid]::NewGuid().ToString('N') + '.mjs'
    $temp = Join-Path $directory $name
    $script = @'
let stage='START',sql;
const report=(a,b)=>console.log('ONESHOT_DIAG '+a+' '+b);
const timer=setTimeout(()=>{report(stage,'TIMEOUT');Deno.exit(1)},45000);
function classify(e){
 const chain=[];for(let n=0;e&&n<4;n++,e=e.cause)chain.push(e);
 const codes=chain.map(e=>String(e.code||''));
 if(codes.includes('28P01')||codes.includes('28000'))return 'AUTH_REJECTED';
 if(codes.includes('42501'))return 'PERMISSION_DENIED';
 if(codes.includes('42P01')||codes.includes('42703'))return 'SCHEMA_MISSING';
 if(codes.includes('53300'))return 'TOO_MANY_CONNECTIONS';
 if(codes.includes('57014'))return 'QUERY_TIMEOUT';
 const text=chain.map(e=>String(e.message||'')).join(' ').toLowerCase();
 if(/certificate|self.signed|issuer|cert_|tls|ssl/.test(text))return 'TLS_ERROR';
 if(/password authentication|tenant or user not found/.test(text))return 'AUTH_REJECTED';
 if(/timeout|timed out/.test(text))return 'TIMEOUT';
 if(/econnrefused|econnreset|enotfound|ehostunreach|enetunreach|connection refused|connection closed|network|dns/.test(text+' '+codes.join(' ').toLowerCase()))return 'NETWORK_ERROR';
 return 'FAILED';
}
try {
 stage='CONFIG';
 const raw=Deno.env.get('SOURCE_DATABASE_URL');
 if(!raw){report(stage,'MISSING');Deno.exit(1)}
 const uri=new URL(raw);
 if(!['postgres:','postgresql:'].includes(uri.protocol)||uri.hash||!uri.password||uri.hostname!=='aws-1-eu-west-1.pooler.supabase.com'||uri.port!=='5432'||uri.searchParams.get('sslmode')!=='verify-full'){
  report(stage,'INVALID');Deno.exit(1);
 }
 report(stage,'OK');
 stage='FILES';
 for(const [file,label] of [['club-export.json','EXPORT'],['club-export.json.sha256','CHECKSUM']]){
  try{await Deno.stat('/transfer/'+file);report(stage,label+'_PRESENT');}
  catch(e){if(e instanceof Deno.errors.NotFound)report(stage,label+'_ABSENT');else throw e;}
 }
 stage='WRITE';
 const probe='/transfer/probe-'+crypto.randomUUID()+'.tmp';
 try{await Deno.writeTextFile(probe,'test',{createNew:true});}finally{try{await Deno.remove(probe)}catch{}}
 report(stage,'OK');
 stage='DRIVER';
 const {default:postgres}=await import('npm:postgres@3.4.7');report(stage,'OK');
 stage='CERTIFICATE';
 let ca;
 try{ca=await Deno.readTextFile('/transfer/supabase-ca.crt');}
 catch(e){if(e instanceof Deno.errors.NotFound){report(stage,'MISSING');Deno.exit(1)}throw e;}
 const {X509Certificate}=await import('node:crypto');
 try{
  if(!ca.includes('-----BEGIN CERTIFICATE-----')||ca.includes('PRIVATE KEY'))throw Error('invalid_certificate');
  new X509Certificate(ca);
 }catch{report(stage,'INVALID');Deno.exit(1)}
 report(stage,'OK');
 stage='CONNECT';
 // Explicit CA trust, chain verification and hostname verification. Never use
 // rejectUnauthorized:false or disable verification to make an export work.
 sql=postgres(raw,{max:1,connect_timeout:8,onnotice:()=>{},ssl:{ca,rejectUnauthorized:true,servername:uri.hostname},connection:{statement_timeout:10000}});
 await sql.begin(async tx=>{
  await tx.unsafe('set transaction isolation level repeatable read, read only');
  await tx.unsafe('select 1');report('CONNECT','OK');
  stage='READINESS';
  const rows=await tx.unsafe("select exists(select 1 from public.club_worker where lease_until>now()) as live, (select count(*) from public.club_commands where status in ('queued','running')) + (select count(*) from public.club_auth_requests where status in ('pending','running')) as pending");
  report(stage,rows[0].live?'DESK_ACTIVE':Number(rows[0].pending)?'PENDING_OPERATIONS':'OK');
  stage='TABLES';
  for(const table of ['profiles','hosts_cache','reservations','club_settings','club_bookings','club_events','club_accounts','club_commands','club_auth_requests'])await tx.unsafe('select 1 from public.'+table+' limit 1');
  report(stage,'OK');
 });
 report('DONE','OK');
}catch(e){report(stage,classify(e));Deno.exitCode=1;}
finally{if(sql)try{await sql.end({timeout:2})}catch{report('CLOSE','FAILED')}clearTimeout(timer);}
'@
    [IO.File]::WriteAllText($temp,$script,(New-Object Text.UTF8Encoding($false)))
    Write-Host 'Checking configuration, file access and a read-only database connection. Passwords and raw errors will NOT be shown.'
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(docker compose run --rm --no-deps -v "${directory}:/transfer" api run --env-file=/transfer/transfer.env --allow-net --allow-env --allow-read --allow-write=/transfer "/transfer/$name" 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    $found = $false
    $stages = @('START','CONFIG','FILES','WRITE','DRIVER','CERTIFICATE','CONNECT','READINESS','TABLES','CLOSE','DONE')
    $results = @('OK','MISSING','INVALID','FAILED','TIMEOUT','AUTH_REJECTED','PERMISSION_DENIED','SCHEMA_MISSING','TOO_MANY_CONNECTIONS','QUERY_TIMEOUT','TLS_ERROR','NETWORK_ERROR','EXPORT_PRESENT','EXPORT_ABSENT','CHECKSUM_PRESENT','CHECKSUM_ABSENT','DESK_ACTIVE','PENDING_OPERATIONS')
    foreach ($entry in $output) {
        $line = [string]$entry
        if ($line -cmatch '^ONESHOT_DIAG ([A-Z_]+) ([A-Z_]+)$' -and $stages -ccontains $Matches[1] -and $results -ccontains $Matches[2]) {
            Write-Host $line
            $found = $true
        }
    }
    $output = $null
    if (-not $found) { Write-Host 'ONESHOT_DIAG START FAILED' }
    Write-Host 'Send only the ONESHOT_DIAG lines above. No database data was changed.'
    if ($code -ne 0) { exit 1 }
} catch {
    Write-Host 'ONESHOT_DIAG START FAILED'
    Write-Host 'Diagnostics could not start. Raw errors were suppressed to protect secrets.'
    exit 1
} finally {
    if ($temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
