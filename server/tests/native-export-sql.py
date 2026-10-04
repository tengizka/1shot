"""CI only: execute the exact embedded export SQL through real psql."""
import json,subprocess
from pathlib import Path
text=Path('server/Export-Native.ps1').read_text()
query=text.split("$query = @'\n",1)[1].split("\n'@",1)[0]
# Exceed FETCH_COUNT to exercise several cursor batches, not only one row.
subprocess.run(['docker','compose','-f','server/compose.yaml','exec','-T','db','psql','-U','oneshot_owner','-d','oneshot','-v','ON_ERROR_STOP=1','-c',"insert into profiles(telegram_id,gizmo_user_id,username) select 10000+n,10000+n,'batch-'||n from generate_series(1,450) n"],check=True,capture_output=True)
result=subprocess.run(['docker','compose','-f','server/compose.yaml','exec','-T','db','psql','-U','oneshot_owner','-d','oneshot','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','FETCH_COUNT=200'],input=query,text=True,capture_output=True,check=True)
lines=result.stdout.splitlines()
bundle=json.loads(lines.pop(0));bundle['tables']={};table=None
for index,line in enumerate(lines):
 if line=='ONESHOT_END':
  counts=json.loads(lines[index+1]);assert all(len(bundle['tables'][t])==n for t,n in counts.items());break
 if line.startswith('ONESHOT_TABLE '):
  table=line[len('ONESHOT_TABLE '):];bundle['tables'][table]=[]
 else:bundle['tables'][table].append(json.loads(line))
else:raise AssertionError('Missing end marker')
assert 'jsonb_agg' not in query
assert bundle['format']=='1shot-local-v1'
assert len(bundle['tables'])==9
assert len(bundle['tables']['profiles'])==451
assert any(r['username']=='CI user' for r in bundle['tables']['profiles'])
assert all(row['cipher'] is None for row in bundle['tables']['club_auth_requests'])
print('Real psql quiet-mode JSON export: PASS')
