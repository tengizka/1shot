"""CI only: execute the exact embedded export SQL through real psql."""
import json,subprocess
from pathlib import Path
text=Path('server/Export-Native.ps1').read_text()
query=text.split("$query = @'\n",1)[1].split("\n'@",1)[0]
result=subprocess.run(['docker','compose','-f','server/compose.yaml','exec','-T','db','psql','-U','oneshot_owner','-d','oneshot','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,check=True)
bundle=json.loads(result.stdout)
assert bundle['format']=='1shot-local-v1'
assert len(bundle['tables'])==9
assert bundle['tables']['profiles'][0]['username']=='CI user'
assert all(row['cipher'] is None for row in bundle['tables']['club_auth_requests'])
print('Real psql quiet-mode JSON export: PASS')
