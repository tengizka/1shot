# -*- coding: utf-8 -*-
"""
Локальный агент для компа с Gizmo Server.
v3 — создание броней через PUT по docs.json, проверка ответа и журнал повторов.
"""

import time
import os
import sys
from pathlib import Path
import json
import logging
import base64
from datetime import datetime, timedelta, timezone

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============ НАСТРОЙКИ ============

GIZMO_BASE_URL = os.environ.get("GIZMO_BASE_URL", "")
GIZMO_LOGIN = os.environ.get("GIZMO_LOGIN", "")
GIZMO_PASSWORD = os.environ.get("GIZMO_PASSWORD", "")
GIZMO_VERIFY_SSL = os.environ.get("GIZMO_VERIFY_SSL", "true").lower() not in ("false", "0", "no")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
AGENT_SECRET = os.environ.get("AGENT_SECRET", "")

SYNC_HOSTS_INTERVAL      = 6   # сек
CHECK_RESERVATIONS_INTERVAL = 3
CHECK_AUTH_INTERVAL      = 3

# UserGroupId=3 — обычные гости (подтверждено тестом PUT /api/users)
GUEST_USER_GROUP_ID = 3

DEBUG_PRINT_EVERY = 0

# ============================================================

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("agent")
_debug_counter = 0

ADMIN_STATE_NORMAL   = 0
ADMIN_STATE_DISABLED = 1
ADMIN_STATE_BLOCKED  = 2


# ─── Gizmo helpers ───────────────────────────────────────────

def get_gizmo_auth_header():
    auth_str    = f"{GIZMO_LOGIN}:{GIZMO_PASSWORD}"
    auth_base64 = base64.b64encode(auth_str.encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {auth_base64}"}


def gizmo_get(path, **kwargs):
    return requests.get(
        f"{GIZMO_BASE_URL}/{path}",
        headers=get_gizmo_auth_header(),
        verify=GIZMO_VERIFY_SSL,
        timeout=5,
        **kwargs,
    )


def gizmo_put(path, **kwargs):
    return requests.put(
        f"{GIZMO_BASE_URL}/{path}",
        headers=get_gizmo_auth_header(),
        verify=GIZMO_VERIFY_SSL,
        timeout=5,
        **kwargs,
    )


def gizmo_post(path, **kwargs):
    return requests.post(
        f"{GIZMO_BASE_URL}/{path}",
        headers=get_gizmo_auth_header(),
        verify=GIZMO_VERIFY_SSL,
        timeout=5,
        **kwargs,
    )


# ─── Supabase helpers ─────────────────────────────────────────

def _supa_headers():
    return {"x-agent-secret": AGENT_SECRET, "Content-Type": "application/json"}


def post_to_supabase(path, payload):
    return requests.post(
        f"{SUPABASE_URL}/functions/v1/{path}",
        headers=_supa_headers(),
        json={**payload, "secret": AGENT_SECRET},
        timeout=(5, 15),
    )


def get_from_supabase(path, params=None):
    p = dict(params or {})
    p["secret"] = AGENT_SECRET
    return requests.get(
        f"{SUPABASE_URL}/functions/v1/{path}",
        headers=_supa_headers(),
        params=p,
        timeout=(5, 15),
    )


def patch_to_supabase(path, payload):
    return requests.patch(
        f"{SUPABASE_URL}/functions/v1/{path}",
        headers=_supa_headers(),
        json={**payload, "secret": AGENT_SECRET},
        timeout=(5, 15),
    )


# ─── Хосты ───────────────────────────────────────────────────

def get_zone_for_host(number) -> str:
    try:
        n = int(number)
    except (ValueError, TypeError):
        return "unknown"
    if n == 1:
        return "ps5"
    if 10 <= n < 20:
        return "10"
    if 20 <= n < 30:
        return "20"
    if n >= 100:
        return str((n // 100) * 100)
    return str(n)


def map_gizmo_status(host: dict, busy_numbers: set) -> str:
    if host.get("isDeleted"):
        return "broken"
    state = host.get("state")
    if state == ADMIN_STATE_DISABLED:
        return "broken"
    if state == ADMIN_STATE_BLOCKED:
        return "reserved"
    if state != ADMIN_STATE_NORMAL:
        log.warning("Неизвестное state=%s у хоста %s", state, host.get("number"))
        return "broken"
    if str(host.get("number")) in {str(n) for n in busy_numbers}:
        return "busy"
    return "free"


def fetch_busy_host_numbers() -> set:
    resp = gizmo_get("usersessions/activeinfo")
    resp.raise_for_status()
    raw  = resp.json()
    sessions = raw.get("result", []) if isinstance(raw, dict) else raw
    return {s.get("hostNumber") for s in sessions if s.get("hostNumber") is not None}


def fetch_gizmo_hosts() -> list:
    resp = gizmo_get("hosts")
    resp.raise_for_status()
    raw = resp.json()

    global _debug_counter
    if DEBUG_PRINT_EVERY and _debug_counter % DEBUG_PRINT_EVERY == 0:
        print("=" * 60)
        print("СЫРОЙ ОТВЕТ /hosts (первые 3):")
        items = raw.get("result", [])[:3] if isinstance(raw, dict) else raw[:3]
        print(json.dumps(items, ensure_ascii=False, indent=2))
        print("=" * 60)
    _debug_counter += 1

    if isinstance(raw, dict):
        return raw.get("result", []) or []
    if isinstance(raw, list):
        return raw
    return []


def sync_hosts_once():
    try:
        gizmo_hosts = fetch_gizmo_hosts()
    except Exception as e:
        log.warning("Не удалось получить хосты из Gizmo: %s", e)
        return

    if not gizmo_hosts:
        log.warning("Список хостов пуст — синхронизация пропущена")
        return

    try:
        busy_numbers = fetch_busy_host_numbers()
    except Exception as e:
        log.warning("Не удалось получить activeinfo: %s — синхронизация пропущена, чтобы не показать занятые ПК свободными", e)
        return

    payload_hosts = []
    for h in gizmo_hosts:
        if h.get("isDeleted"):
            continue
        number = h.get("number")
        payload_hosts.append({
            "host_id":      str(number if number is not None else h.get("name")),
            "zone":         get_zone_for_host(number),
            "status":       map_gizmo_status(h, busy_numbers),
            "gizmo_host_id": str(h.get("id")),
        })

    try:
        resp = post_to_supabase("sync-hosts", {"hosts": payload_hosts})
        if resp.status_code != 200:
            log.warning("sync-hosts вернул %s: %s", resp.status_code, resp.text)
        else:
            log.info("✓ Синхронизировано хостов: %d", len(payload_hosts))
    except Exception as e:
        log.warning("Не удалось отправить статусы в Supabase: %s", e)


# ─── Брони ───────────────────────────────────────────────────

def gizmo_reservation_error_detail(text):
    # Never echo configured credentials even if a proxy reflects them.
    detail = str(text)
    for secret in (GIZMO_PASSWORD, AGENT_SECRET, get_gizmo_auth_header().get("Authorization", "")):
        if secret:
            detail = detail.replace(secret, "[REDACTED]")
    return " ".join(detail.split())[:2000] or "Пустой ответ. Нужна схема API Gizmo для создания брони."


class GizmoReservationUncertain(RuntimeError):
    """A write may have succeeded: never automatically send it a second time."""
    def __init__(self, message, reservation_id=None):
        super().__init__(message)
        self.reservation_id = reservation_id


_reservation_unit_seconds = None
RESERVATION_JOURNAL = Path(__file__).resolve().with_name("agent-reservations.json")


def parse_gizmo_date(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def infer_reservation_unit_seconds(records):
    """Infer undocumented units by comparing existing duration and endDate-date."""
    units = set()
    for record in records:
        try:
            duration = record["duration"]
            if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
                continue
            elapsed = (parse_gizmo_date(record["endDate"]) - parse_gizmo_date(record["date"])).total_seconds()
            if elapsed <= 0:
                continue
            matches = [unit for unit in (1, 60) if abs(elapsed - duration * unit) <= 0.1]
            if not matches:
                raise ValueError("Gizmo Duration: неподдерживаемые единицы времени в существующей брони")
            units.update(matches)
        except (KeyError, TypeError):
            continue
    if len(units) != 1:
        raise ValueError("Gizmo Duration: единицы не определены. Нужна существующая бронь с date, endDate и duration. Создайте тестовую бронь вручную в Gizmo и запустите agent.py --check-reservations")
    return units.pop()


def get_reservation_unit_seconds():
    global _reservation_unit_seconds
    if _reservation_unit_seconds is None:
        response = gizmo_get("reservations", params={"Take": 50})
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            if data.get("isError"):
                raise ValueError("Не удалось прочитать брони для определения Duration")
            data = data.get("result")
        if not isinstance(data, list):
            raise ValueError("GET reservations: ожидался список броней")
        _reservation_unit_seconds = infer_reservation_unit_seconds(data)
        log.info("Gizmo Duration: одна единица = %s секунд (проверено по date/endDate)", _reservation_unit_seconds)
    return _reservation_unit_seconds


def build_reservation_params(host_id, gizmo_user_id, requested_at, unit_seconds, request_id):
    if isinstance(gizmo_user_id, bool) or not isinstance(gizmo_user_id, int) or gizmo_user_id <= 0:
        raise ValueError("profile_gizmo_user_id_missing: обновите pending-reservations и повторно войдите в мини-апп")
    if int(host_id) <= 0 or unit_seconds not in (1, 60):
        raise ValueError("invalid_reservation_parameters")
    requested = parse_gizmo_date(requested_at)
    now = datetime.now(timezone.utc)
    if requested + timedelta(minutes=60) <= now:
        raise ValueError("reservation_expired")
    if requested > now + timedelta(seconds=30):
        raise ValueError("reservation_created_at_in_future")
    # ASP.NET query model binding for the object arrays in docs.json.
    return {
        "Date": requested.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "Duration": 3600 // unit_seconds,
        "UserId": gizmo_user_id,
        "Hosts[0].HostId": int(host_id),
        "Note": f"1SHOT app request={request_id}",
    }


def validate_gizmo_booking_user(user_id):
    """Verify the profile points to a real Gizmo member before any write."""
    if isinstance(user_id, bool) or not isinstance(user_id, int) or user_id <= 0:
        raise ValueError("invalid_gizmo_user_id")
    try:
        response = gizmo_get(f"users/{user_id}")
    except requests.exceptions.RequestException as error:
        raise ValueError("Gizmo: не удалось проверить аккаунт; запрос создания брони не отправлен") from error
    if not 200 <= response.status_code < 300:
        raise ValueError(f"Gizmo GET /users/{user_id} HTTP {response.status_code}: "
                         + gizmo_reservation_error_detail(response.text))
    data = response.json()
    if isinstance(data, dict) and data.get("isError"):
        raise ValueError("Gizmo: ошибка чтения аккаунта, создание брони отменено")
    if isinstance(data, dict) and "result" in data:
        data = data["result"]
    if not isinstance(data, dict) or data.get("id") != user_id or data.get("isDeleted"):
        raise ValueError("Gizmo: профиль ссылается на отсутствующий или удалённый аккаунт; войдите заново")


def create_gizmo_reservation(params, unit_seconds):
    # docs.json: PUT creates, POST updates. This is query data, NOT JSON.
    validate_gizmo_booking_user(params["UserId"])
    log.info("Создание брони Gizmo: hostId=%s, userId=%s, Duration=%s",
             params["Hosts[0].HostId"], params["UserId"], params["Duration"])
    try:
        resp = gizmo_put("reservations", params=params)
    except requests.exceptions.RequestException as error:
        raise GizmoReservationUncertain("Gizmo PUT: результат неизвестен после сетевой ошибки, проверьте бронь вручную") from error
    if not 200 <= resp.status_code < 300:
        detail = gizmo_reservation_error_detail(resp.text)
        message = f"Gizmo PUT /reservations HTTP {resp.status_code}: {detail}"
        if resp.status_code >= 500 or resp.status_code == 408:
            raise GizmoReservationUncertain(message)
        raise ValueError(message)
    reservation_id = None
    try:
        data = resp.json()
        if isinstance(data, dict):
            if data.get("isError"):
                raise GizmoReservationUncertain("Gizmo PUT: ответ isError, проверьте результат вручную")
            data = data.get("id") or data.get("result")
            if isinstance(data, dict):
                data = data.get("id")
        if isinstance(data, bool) or not isinstance(data, (int, str)) or not str(data).isdigit() or int(data) <= 0:
            raise GizmoReservationUncertain("Gizmo PUT: отсутствует корректный ID, проверьте результат вручную")
        reservation_id = str(data)
        # Avoid ambiguous nested Users binding. This documented endpoint takes
        # the real Gizmo member ID directly in the URL, never a default zero.
        user_path = f"reservations/{reservation_id}/users/{params['UserId']}"
        linked = gizmo_put(user_path)
        if not 200 <= linked.status_code < 300:
            raise ValueError(f"Gizmo PUT /{user_path} HTTP {linked.status_code}: "
                             + gizmo_reservation_error_detail(linked.text))
        if linked.content:
            linked_data = linked.json()
            if isinstance(linked_data, dict) and linked_data.get("isError"):
                raise ValueError("Gizmo: привязка пользователя вернула isError")
        # Verify the server actually accepted the host, account and one-hour span.
        check = gizmo_get(f"reservations/{reservation_id}")
        check.raise_for_status()
        actual = check.json()
        if isinstance(actual, dict) and "result" in actual:
            if actual.get("isError"):
                raise ValueError("Gizmo readback isError")
            actual = actual["result"]
        expected_start = parse_gizmo_date(params["Date"])
        expected_end = expected_start + timedelta(seconds=params["Duration"] * unit_seconds)
        if (str(actual["id"]) != reservation_id
                or params["Hosts[0].HostId"] not in [int(h["hostId"]) for h in actual["hosts"]]
                or actual.get("userId") != params["UserId"]
                or params["UserId"] not in [u["userId"] for u in actual.get("users", [])]
                or abs((parse_gizmo_date(actual["date"]) - expected_start).total_seconds()) > 2
                or abs((parse_gizmo_date(actual["endDate"]) - expected_end).total_seconds()) > 2):
            raise ValueError("Gizmo readback mismatch (host/user/date/endDate)")
        log.info("Gizmo бронь %s проверена: окончание %s", reservation_id, actual["endDate"])
        return reservation_id
    except Exception as error:
        raise GizmoReservationUncertain(
            f"Gizmo: бронь могла быть создана (ID={reservation_id}); проверка не пройдена: "
            f"{gizmo_reservation_error_detail(str(error))}. Автоповтора не будет", reservation_id
        ) from error


def save_reservation_journal(journal):
    temporary = RESERVATION_JOURNAL.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(journal, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(RESERVATION_JOURNAL)


def load_reservation_journal():
    if not RESERVATION_JOURNAL.exists():
        return {}
    journal = json.loads(RESERVATION_JOURNAL.read_text(encoding="utf-8"))
    if not isinstance(journal, dict):
        raise ValueError("Повреждён журнал броней. Не удаляйте его: сначала проверьте Gizmo")
    return journal


def process_pending_reservations():
    try:
        journal = load_reservation_journal()
        resp = get_from_supabase("pending-reservations")
        resp.raise_for_status()
        pending = resp.json().get("reservations", [])
        if not pending:
            return
        gizmo_hosts = fetch_gizmo_hosts()
        host_id_to_gizmo = {str(h.get("number")): str(h.get("id")) for h in gizmo_hosts if not h.get("isDeleted")}
        unit_seconds = get_reservation_unit_seconds()
    except Exception as error:
        log.warning("Подготовка броней не удалась: %s", gizmo_reservation_error_detail(str(error)))
        return
    log.info("Новых броней к обработке: %d", len(pending))
    for reservation in pending:
        request_id = str(reservation["id"])
        previous = journal.get(request_id)
        if previous:
            if previous["status"] == "confirmed":
                report_reservation(request_id, "confirmed", gizmo_reservation_id=previous["gizmo_reservation_id"])
            elif previous["status"] == "failed":
                report_reservation(request_id, "failed", error_message=previous["error_message"])
            else:
                log.warning("Бронь %s требует ручной проверки Gizmo (ID=%s), повторная отправка заблокирована", request_id, previous.get("gizmo_reservation_id"))
            continue
        try:
            host_id = host_id_to_gizmo.get(str(reservation["host_id"]))
            if not host_id:
                raise ValueError("host_not_found_in_gizmo")
            if str(reservation["host_id"]).strip().lower() in ("1", "ps5"):
                raise ValueError("ps5_phone_only: PS5 бронируется только по телефону клуба")
            params = build_reservation_params(host_id, reservation.get("gizmo_user_id"),
                                              reservation["created_at"], unit_seconds, request_id)
            # Persist intent BEFORE the network side effect; restart must not replay it.
            journal[request_id] = {"status": "uncertain"}
            save_reservation_journal(journal)
            gizmo_id = create_gizmo_reservation(params, unit_seconds)
            journal[request_id] = {"status": "confirmed", "gizmo_reservation_id": gizmo_id}
            save_reservation_journal(journal)
            report_reservation(request_id, "confirmed", gizmo_reservation_id=gizmo_id)
        except GizmoReservationUncertain as error:
            journal[request_id] = {"status": "uncertain", "gizmo_reservation_id": error.reservation_id}
            save_reservation_journal(journal)
            log.error("Бронь %s: %s", request_id, error)
        except ValueError as error:
            message = gizmo_reservation_error_detail(str(error))
            journal[request_id] = {"status": "failed", "error_message": message}
            save_reservation_journal(journal)
            report_reservation(request_id, "failed", error_message=message)
            log.warning("Не удалось создать бронь %s: %s", request_id, message)


def report_reservation(res_id, status, gizmo_reservation_id=None, error_message=None):
    try:
        payload = {"id": res_id, "status": status}
        if gizmo_reservation_id:
            payload["gizmo_reservation_id"] = gizmo_reservation_id
        if error_message:
            payload["error_message"] = error_message
        response = patch_to_supabase("pending-reservations", payload)
        response.raise_for_status()
    except Exception as e:
        log.warning("Не удалось отчитаться по брони %s: %s", res_id, e)


# ─── Авторизация гостей ──────────────────────────────────────

def validate_gizmo_credentials(username: str, password: str):
    """
    GET /api/users/{username}/{password}/valid
    Возвращает (True, gizmo_user_id) или (False, None).
    """
    resp = gizmo_get(
        f"users/{requests.utils.quote(username, safe='')}/"
        f"{requests.utils.quote(password, safe='')}/valid"
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("isError"):
        return False, None
    identity = data.get("result", {})
    if identity.get("result") != 0:
        return False, None
    user_id = identity.get("identity", {}).get("userId")
    return True, user_id


def create_gizmo_user(username: str, password: str, first_name: str = "", last_name: str = "") -> int:
    """
    PUT /api/users → POST /api/users/{id}/password/{pwd}
    Возвращает gizmo_user_id нового пользователя.
    """
    params = {"Username": username, "UserGroupId": GUEST_USER_GROUP_ID}
    if first_name:
        params["FirstName"] = first_name
    if last_name:
        params["LastName"] = last_name

    r_create = gizmo_put("users", params=params)
    r_create.raise_for_status()
    data = r_create.json()
    gizmo_user_id = data.get("result")
    if not gizmo_user_id:
        raise ValueError(f"PUT /api/users не вернул ID: {data}")

    r_pwd = gizmo_post(
        f"users/{gizmo_user_id}/password/{requests.utils.quote(password, safe='')}"
    )
    r_pwd.raise_for_status()
    return int(gizmo_user_id)


def upsert_profile(telegram_id: int, gizmo_user_id: int, username: str,
                   first_name: str = "", last_name: str = ""):
    payload = {
        "telegram_id":   telegram_id,
        "gizmo_user_id": gizmo_user_id,
        "username":      username,
    }
    if first_name:
        payload["first_name"] = first_name
    if last_name:
        payload["last_name"] = last_name
    response = post_to_supabase("upsert-profile", payload)
    # Login must not be reported done unless the database saved its identity.
    # Raise a safe error rather than propagating a URL that may include secrets.
    if not response.ok:
        raise RuntimeError(f"profile_save_failed_http_{response.status_code}")
    if response.json().get("ok") is not True:
        raise RuntimeError("profile_save_not_confirmed")


def report_auth(req_id: str, status: str, gizmo_user_id=None, error_message: str = ""):
    try:
        payload = {"id": req_id, "status": status}
        if gizmo_user_id is not None:
            payload["gizmo_user_id"] = gizmo_user_id
        if error_message:
            payload["error_message"] = error_message
        patch_to_supabase("pending-auth", payload)
    except Exception as e:
        log.warning("Не удалось отчитаться по auth req %s: %s", req_id, e)


def handle_login(req_id: str, telegram_id: int, username: str, password: str):
    try:
        ok, gizmo_user_id = validate_gizmo_credentials(username, password)
        if not ok:
            report_auth(req_id, "invalid_credentials")
            log.info("Неверный логин/пароль для '%s' (telegram_id=%s)", username, telegram_id)
            return
        upsert_profile(telegram_id, gizmo_user_id, username)
        report_auth(req_id, "done", gizmo_user_id=gizmo_user_id)
        log.info("✓ Вход: telegram_id=%s → gizmo_user_id=%s (%s)", telegram_id, gizmo_user_id, username)
    except Exception as e:
        report_auth(req_id, "failed", error_message=str(e))
        log.warning("Ошибка обработки login req %s: %s", req_id, e)


def handle_register(req_id: str, telegram_id: int, username: str, password: str,
                    first_name: str, last_name: str):
    try:
        # Проверяем, что логин свободен
        r_exist = gizmo_get(f"users/loginname/{requests.utils.quote(username, safe='')}/exist")
        r_exist.raise_for_status()
        exist_result = r_exist.json().get("result")
        if exist_result is True:
            report_auth(req_id, "username_taken")
            log.info("Логин '%s' уже занят (telegram_id=%s)", username, telegram_id)
            return

        gizmo_user_id = create_gizmo_user(username, password, first_name, last_name)
        upsert_profile(telegram_id, gizmo_user_id, username, first_name, last_name)
        report_auth(req_id, "done", gizmo_user_id=gizmo_user_id)
        log.info("✓ Регистрация: '%s' → gizmo_user_id=%s (telegram_id=%s)",
                 username, gizmo_user_id, telegram_id)
    except Exception as e:
        report_auth(req_id, "failed", error_message=str(e))
        log.warning("Ошибка обработки register req %s: %s", req_id, e)


def process_auth_requests():
    try:
        resp = get_from_supabase("pending-auth")
        resp.raise_for_status()
        auth_list = resp.json().get("requests", [])
    except requests.exceptions.Timeout:
        log.warning("pending-auth: Supabase не ответил вовремя (подключение 5с, чтение 15с). Повторим в следующем цикле; это не ошибка логина")
        return
    except Exception as e:
        log.warning("Не удалось получить auth_requests (%s). Проверьте сеть и логи pending-auth в Supabase", type(e).__name__)
        return

    if not auth_list:
        return

    log.info("Новых auth запросов: %d", len(auth_list))

    for req in auth_list:
        req_id      = req["id"]
        action      = req["action"]       # "login" | "register"
        username    = req["username"]
        password    = req["password"]
        telegram_id = req["telegram_id"]

        if action == "login":
            handle_login(req_id, telegram_id, username, password)
        elif action == "register":
            handle_register(
                req_id, telegram_id, username, password,
                req.get("first_name", ""),
                req.get("last_name", ""),
            )
        else:
            report_auth(req_id, "failed", error_message=f"unknown_action:{action}")


# ─── Баннер ──────────────────────────────────────────────────

def print_banner():
    width = 60
    lines = [
        "made tengizka",
        "",
        "   ██╗ ███████╗██╗  ██╗ ██████╗ ████████╗",
        "  ███║ ██╔════╝██║  ██║██╔═══██╗╚══██╔══╝",
        " ╚═██║ ███████╗███████║██║   ██║   ██║   ",
        "   ██║ ╚════██║██╔══██║██║   ██║   ██║   ",
        " █████╗███████║██║  ██║╚██████╔╝   ██║   ",
        " ╚════╝╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ",
        "",
        "◈ agent.py v3.1 — PUT + explicit user link ◈",
    ]
    print()
    for line in lines:
        print(line.center(width))
    print()


# ─── Главный цикл ────────────────────────────────────────────

def main():
    print_banner()
    log.info(
        "Агент запущен. Хосты каждые %ss, брони каждые %ss, auth каждые %ss",
        SYNC_HOSTS_INTERVAL, CHECK_RESERVATIONS_INTERVAL, CHECK_AUTH_INTERVAL,
    )

    last_hosts_sync          = 0
    last_reservations_check  = 0
    last_auth_check          = 0

    while True:
        now = time.time()
        try:
            if now - last_hosts_sync >= SYNC_HOSTS_INTERVAL:
                sync_hosts_once()
                last_hosts_sync = now
            if now - last_reservations_check >= CHECK_RESERVATIONS_INTERVAL:
                process_pending_reservations()
                last_reservations_check = now
            if now - last_auth_check >= CHECK_AUTH_INTERVAL:
                process_auth_requests()
                last_auth_check = now
        except Exception as e:
            log.error("Неожиданная ошибка в главном цикле: %s", e)
        time.sleep(1)


if __name__ == "__main__":
    missing = [key for key in ("GIZMO_BASE_URL", "GIZMO_LOGIN", "GIZMO_PASSWORD", "SUPABASE_URL", "AGENT_SECRET") if not os.environ.get(key)]
    if missing:
        sys.exit("Задайте переменные окружения: " + ", ".join(missing))
    if "--check-reservations" in sys.argv:
        try:
            unit = get_reservation_unit_seconds()
            print(f"Проверено чтением Gizmo: Duration за 60 минут = {3600 // unit}. Ничего не создано.")
        except Exception as error:
            print(gizmo_reservation_error_detail(str(error)))
            sys.exit(1)
    else:
        main()
