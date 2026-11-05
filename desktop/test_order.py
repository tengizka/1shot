"""Settings → «Тесты» → «Тестовый заказ»: one cheap item ordered for a guest the way the mini-app will order,
from the owner's money account and paid from the guest's deposit. Staff then confirm or cancel it in Gizmo as usual."""
import os
import re
from .services import ApiError
from .food import RENTAL_GROUP, PACK_GROUPS


def deposit_method(gizmo):
    """The «Депозит» payment method: PAYMENT_DEPOSIT_METHOD_ID in .env, otherwise the only enabled one with that name."""
    value = os.getenv('PAYMENT_DEPOSIT_METHOD_ID', '').strip()
    if value:
        return int(value)
    rows = gizmo.request('GET', 'v2.0/paymentmethods')
    rows = rows.get('data') if isinstance(rows, dict) else rows
    found = [m for m in rows or [] if not m.get('isDeleted') and re.search(r'депозит|deposit', str(m.get('name', '')), re.I)]
    if len(found) != 1:
        names = ', '.join(f"{m.get('id')} {m.get('name')}" for m in rows or [] if not m.get('isDeleted'))
        raise ValueError(('Укажите PAYMENT_DEPOSIT_METHOD_ID в .env. Способы оплаты Gizmo: ' + names)[:250])
    return int(found[0]['id'])


def find_user(gizmo, username):
    name = str(username or '').strip().casefold()
    if not 2 <= len(name) <= 40:
        raise ValueError('Впишите ник аккаунта')
    rows = gizmo.request('GET', 'users', params={'IsDeleted': False})
    found = [u for u in rows or [] if str(u.get('username', '')).casefold() == name and not u.get('isDeleted')]
    if len(found) != 1:
        raise ValueError('Аккаунт с таким ником не найден')
    return found[0]


def cheapest(menu):
    goods = [i for i in menu if str(i.get('group', '')).strip().casefold() not in {RENTAL_GROUP} | PACK_GROUPS and i.get('price', 0) > 0]
    if not goods:
        raise ValueError('В меню нет товаров для теста')
    return min(goods, key=lambda i: (i['price'], i['id']))


def place(desk_gizmo, money, menu, username):
    user = find_user(desk_gizmo, username)
    item = cheapest(menu)
    method = deposit_method(desk_gizmo)
    try:
        result = money.request('POST', f"users/{int(user['id'])}/order/{int(item['id'])}/1/invoice/payment/{method}")
    except ApiError as error:
        raise ValueError(f'Gizmo не принял заказ: {error}'[:200]) from error
    owner = money is not desk_gizmo
    return {'ok': True, 'user': user.get('username'), 'item': item['name'], 'price': item['price'],
            'method': method, 'owner_account': owner, 'result': str(result)[:120]}
