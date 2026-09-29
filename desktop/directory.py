"""Local-only staff account directory. Cache only display fields, never credentials."""
import re
import threading
import time
from .engine import UnsafeOperation

FIELDS=('id','username','firstName','lastName','mobilePhone','phone','userGroupId','isDisabled')
class Directory:
    def __init__(self,gizmo):
        self.gizmo=gizmo;self.lock=threading.RLock();self.rows=[];self.at=0;self.groups={};self.groups_at=0
    def group_names(self,fresh=False):
        with self.lock:
            if fresh or time.monotonic()-self.groups_at>30 or not self.groups_at:
                try:
                    groups=self.gizmo.request('GET','usergroups')
                    if not isinstance(groups,list):raise ValueError()
                    self.groups={g['id']:g.get('name','') for g in groups};self.groups_at=time.monotonic()
                except Exception:
                    return {}  # Unknown group always requires the extra staff confirmation.
            return dict(self.groups)
    def describe(self,user,groups):
        result={k:user.get(k) for k in FIELDS}
        name=groups.get(user.get('userGroupId'),'')
        result.update(group_name=name or 'Группа '+str(user.get('userGroupId','?')),
                      requires_privileged_confirmation=name.strip().casefold() not in ('клиенты','18+'))
        return result
    def get(self,uid,fresh=False):
        user=self.gizmo.user(int(uid))
        return self.describe(user,self.group_names(fresh))
    def search(self,query):
        if not isinstance(query,str) or not 2<=len(query.strip())<=80:return {'users':[],'more':False}
        query=query.strip().casefold().replace('ё','е');tokens=query.split();digits=re.sub(r'\D','',query)
        with self.lock:
            if not self.at or time.monotonic()-self.at>30:
                rows=self.gizmo.request('GET','users',params={'IsDeleted':False})
                if not isinstance(rows,list):raise UnsafeOperation('Сервер не вернул список аккаунтов')
                self.rows=[{k:u.get(k) for k in FIELDS} for u in rows if not u.get('isDeleted') and u.get('id')]
                self.at=time.monotonic()
            groups=self.group_names();matches=[]
            for user in self.rows:
                text=' '.join(str(user.get(k) or '') for k in ('username','firstName','lastName','mobilePhone','phone')).casefold().replace('ё','е')
                phone_match=len(digits)>=3 and bool(re.fullmatch(r'[\d\s()+-]+',query)) and any(digits in re.sub(r'\D','',str(user.get(k) or '')) for k in ('mobilePhone','phone'))
                if all(t in text for t in tokens) or phone_match:matches.append(user)
            matches.sort(key=lambda u:(str(u.get('username','')).casefold()!=query,str(u.get('username','')).casefold(),int(u['id'])))
            return {'users':[self.describe(u,groups) for u in matches[:20]],'more':len(matches)>20}
