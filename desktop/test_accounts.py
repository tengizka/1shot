"""Test accounts: club accounts a tester's Telegram created through the mini-app (server list club_promo_testers).

Settings → «Тесты» lists them; deleting one removes it in Gizmo, checks it is gone, then clears its traces on the server.
Only accounts on the server's list can be deleted, and never while the account plays on a PC.
"""
from .services import ApiError


class TestAccounts:
    def __init__(self, cloud, gizmo, guard=lambda: None):
        self.cloud, self.gizmo, self.guard = cloud, gizmo, guard

    def list(self):
        rows = self.cloud.desk('test_accounts').get('accounts') or []
        out = []
        for row in rows:
            uid = row.get('gizmo_user_id')
            if type(uid) is not int or uid <= 0:
                continue
            try:
                user = self.gizmo.user(uid)
                name, gone = user.get('username') or '', False
            except ApiError:
                name, gone = '', True
            out.append({'gizmo_user_id': uid, 'username': name, 'code': row.get('code'), 'created_at': row.get('created_at'), 'gone': gone})
        return out

    def delete(self, uid):
        uid = int(uid)
        if uid not in {r.get('gizmo_user_id') for r in self.cloud.desk('test_accounts').get('accounts') or []}:
            raise ValueError('Этого аккаунта нет в списке тестовых')
        if any(int(s.get('userId', -1)) == uid for s in self.gizmo.sessions()):
            raise ValueError('Аккаунт сейчас играет за ПК. Завершите сеанс и попробуйте снова')
        try:
            self.gizmo.user(uid)
            exists = True
        except ApiError:
            exists = False
        if exists:
            self.guard()
            last = None
            for path in (f'v2.0/users/{uid}', f'users/{uid}'):
                try:
                    self.gizmo.request('DELETE', path)
                    last = None
                    break
                except ApiError as error:
                    last = error
            try:
                self.gizmo.user(uid)
                still = True
            except ApiError:
                still = False
            if still:
                raise ValueError(f'Gizmo не удалил аккаунт: {last or "неизвестный ответ"}'[:160])
        if self.cloud.desk('test_account_removed', gizmo_user_id=uid).get('ok') is not True:
            raise ValueError('Аккаунт удалён в Gizmo, но сервер не подтвердил очистку. Нажмите ещё раз')
        return {'ok': True}
