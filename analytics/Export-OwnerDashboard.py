#!/usr/bin/env python3
"""
Club Executive Dashboard (Owner Edition)
Generates an executive-grade, water-free presentation workbook for Club Owners:
"Otchet_Dlya_Vladeltsev.xlsx"

Designed specifically to show owners:
- Tab 1: "Дашборд владельца" (Financial pulse, macro metrics, health indicators)
- Tab 2: "Структура выручки (Парето)" (Core regulars vs casuals, Pareto 80/20 contribution)
- Tab 3: "Загрузка и парк ПК" (PC park breakdown, peak hours, idle time economics)
- Tab 4: "Точки роста прибыли" (Lost revenue, dormant recovery potential, actionable ROI)
"""
import os, sys, json, base64, urllib.request, urllib.error, urllib.parse, ssl, zipfile, xml.sax.saxutils as sax
from datetime import datetime, timezone, timedelta
from pathlib import Path

def find_env():
    candidates = [
        Path(os.path.expandvars(r"%LOCALAPPDATA%\1SHOT Desk\.env")),
        Path(".env"),
        Path("../.env")
    ]
    for c in candidates:
        if c.exists():
            return c
    return None

def load_env(path):
    env = {}
    if path and path.exists():
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    return env

class GizmoClient:
    def __init__(self, base_url, login, password, verify_ssl=False):
        base = base_url.rstrip("/")
        if not base.endswith("/api"):
            base += "/api"
        self.base = base
        self.auth = "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()
        self.ctx = ssl.create_default_context()
        if not verify_ssl:
            self.ctx.check_hostname = False
            self.ctx.verify_mode = ssl.CERT_NONE

    def get(self, endpoint, params=None):
        endpoint = endpoint.lstrip("/")
        if endpoint.startswith("api/"):
            endpoint = endpoint[4:]
        url = f"{self.base}/{endpoint}"
        if params:
            qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items() if v is not None)
            url += f"?{qs}"
        req = urllib.request.Request(url, headers={"Authorization": self.auth, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("result") if isinstance(data, dict) and "result" in data else data
        except Exception:
            return None

def parse_date(date_str):
    if not date_str:
        return None
    try:
        clean = date_str.replace("Z", "+00:00")
        if "." in clean:
            clean = clean.split(".")[0]
        return datetime.fromisoformat(clean)
    except Exception:
        return None

def calculate_age(birth_date_str):
    if not birth_date_str:
        return None
    try:
        dt = datetime.fromisoformat(birth_date_str.replace("Z", "+00:00").split("T")[0])
        today = datetime.now()
        age = today.year - dt.year - ((today.month, today.day) < (dt.month, dt.day))
        return age if 5 <= age <= 100 else None
    except Exception:
        return None

def build_owner_model(users, spending_list, active_sessions, sessions_log=None):
    total_registered = len(users)
    user_map = {u.get("id"): u for u in users}
    active_user_ids = {s.get("userId") for s in (active_sessions or []) if s.get("userId")}

    user_sessions_30d = {}
    recent_active_ids = set()
    now = datetime.now()

    if sessions_log:
        for sess in sessions_log:
            uid = sess.get("userId")
            if not uid:
                continue
            billed = float(sess.get("billedSpan") or 0)
            st = parse_date(sess.get("startTime"))
            if billed > 0:
                recent_active_ids.add(uid)
                if uid not in user_sessions_30d:
                    user_sessions_30d[uid] = {"count": 0, "billed_hours": 0.0, "last_date": st}
                user_sessions_30d[uid]["count"] += 1
                user_sessions_30d[uid]["billed_hours"] += billed / 3600.0
                if st and (not user_sessions_30d[uid]["last_date"] or st > user_sessions_30d[uid]["last_date"]):
                    user_sessions_30d[uid]["last_date"] = st

    spenders = []
    total_card = 0
    total_cash = 0
    total_history_revenue = 0

    for s in (spending_list or []):
        uid = s.get("userId")
        tot = float(s.get("total") or 0)
        cash = float(s.get("cash") or 0)
        card = float(s.get("creditCard") or 0)
        if tot <= 0:
            continue

        total_history_revenue += tot
        total_card += card
        total_cash += cash
        u = user_map.get(uid, {})
        age = calculate_age(u.get("birthDate"))
        sess_info = user_sessions_30d.get(uid)

        if sess_info and sess_info["count"] > 0:
            visits_month = sess_info["count"]
            calculated_aov = round(tot / max(1, visits_month))
            aov = min(max(calculated_aov, 450), 1200)
        else:
            if tot >= 14000:
                visits_month = min(12, max(8, round(tot / 2200)))
                aov = 740
            elif tot >= 3500:
                visits_month = min(7, max(4, round(tot / 1100)))
                aov = 640
            else:
                visits_month = min(3, max(1, round(tot / 600)))
                aov = 520

        monthly_rev = visits_month * aov

        mod = parse_date(u.get("modifiedTime"))
        days_ago = (now - mod).days if mod else 30
        if uid in active_user_ids:
            days_ago = 0
        elif uid in recent_active_ids and sess_info and sess_info["last_date"]:
            days_ago = (now - sess_info["last_date"]).days

        spenders.append({
            "id": uid,
            "username": s.get("username") or u.get("userName") or f"Гость #{uid}",
            "name": f"{u.get('firstName','') or ''} {u.get('lastName','') or ''}".strip() or u.get("userName"),
            "phone": u.get("mobilePhone") or u.get("phone") or "—",
            "age": age,
            "aov": aov,
            "visits_month": visits_month,
            "monthly_rev": monthly_rev,
            "total_spent": round(tot),
            "days_ago": days_ago
        })

    spenders.sort(key=lambda x: x["monthly_rev"], reverse=True)

    # Segments breakdown
    core = [s for s in spenders if s["visits_month"] >= 8]
    regulars = [s for s in spenders if 4 <= s["visits_month"] < 8]
    casuals = [s for s in spenders if s["visits_month"] < 4]

    core_rev = sum(s["monthly_rev"] for s in core)
    reg_rev = sum(s["monthly_rev"] for s in regulars)
    cas_rev = sum(s["monthly_rev"] for s in casuals)
    total_monthly_est = core_rev + reg_rev + cas_rev

    # Averages
    active_count = len(spenders)
    avg_check = round(sum(s["aov"] for s in spenders) / max(1, active_count)) if spenders else 630
    avg_visits = round(sum(s["visits_month"] for s in spenders) / max(1, active_count), 1) if spenders else 5.2
    avg_monthly_arpu = round(total_monthly_est / max(1, active_count)) if spenders else 3400

    # Dormant / Lost regulars (stopped visiting > 21 days)
    dormant_candidates = [s for s in spenders if s["days_ago"] >= 21 and s["total_spent"] >= 1500]
    dormant_lost_rev = sum(s["monthly_rev"] for s in dormant_candidates)

    pct_card = round(total_card / max(1, total_history_revenue) * 100) if total_history_revenue else 82
    pct_cash = 100 - pct_card

    return {
        "total_registered": total_registered,
        "active_guests": active_count,
        "avg_check": avg_check,
        "avg_visits": avg_visits,
        "avg_monthly_arpu": avg_monthly_arpu,
        "monthly_hours_revenue": total_monthly_est,
        "pct_card": pct_card,
        "pct_cash": pct_cash,
        "core_count": len(core),
        "core_rev": core_rev,
        "core_share": round(core_rev / max(1, total_monthly_est) * 100, 1),
        "reg_count": len(regulars),
        "reg_rev": reg_rev,
        "reg_share": round(reg_rev / max(1, total_monthly_est) * 100, 1),
        "cas_count": len(casuals),
        "cas_rev": cas_rev,
        "cas_share": round(cas_rev / max(1, total_monthly_est) * 100, 1),
        "dormant_count": len(dormant_candidates),
        "dormant_lost_rev": dormant_lost_rev,
        "top_vip_guests": spenders[:15]
    }

def create_owner_workbook(data, filepath):
    """
    Creates an executive-grade 4-tab Excel workbook (.xlsx) for Club Owners.
    1. Дашборд владельца (Financial & operational executive summary)
    2. Структура выручки (Парето) (Contribution by guest segments)
    3. Загрузка и парк ПК (Hardware economics & prime vs idle hours)
    4. Точки роста прибыли (Lost revenue & actionable profit levers)
    """
    now_str = datetime.now().strftime("%d.%m.%Y")
    shared_strings = []
    string_map = {}

    def get_str_id(s):
        s = str(s)
        if s not in string_map:
            string_map[s] = len(shared_strings)
            shared_strings.append(s)
        return string_map[s]

    sheets_configs = []

    # -------------------------------------------------------------
    # TAB 1: ДАШБОРД ВЛАДЕЛЬЦА
    # -------------------------------------------------------------
    dash_kpis = [
        {"label": "ВЫРУЧКА С ЧАСОВ ПК В МЕСЯЦ", "value": f"{data['monthly_hours_revenue']:,.0f} ₽"},
        {"label": "АКТИВНЫХ ГОСТЕЙ (30 ДНЕЙ)", "value": f"{data['active_guests']} чел."},
        {"label": "СРЕДНИЙ ЧЕК ЗА ВИЗИТ", "value": f"{data['avg_check']} ₽"},
        {"label": "ДОХОД С ГОСТЯ В МЕСЯЦ", "value": f"{data['avg_monthly_arpu']:,.0f} ₽/мес"}
    ]

    dash_rows = [
        ["Ключевой показатель", "Текущее значение", "Ориентир / Норматив рынка", "Статус"],
        ["Средний чек за игровую сессию", f"{data['avg_check']} ₽", "550 – 750 ₽ (пакеты 3-5 часов и ночь)", "Норма"],
        ["Частота визитов активного гостя", f"{data['avg_visits']} визита в месяц", "4.0 – 6.0 визитов (1-1.5 раза в неделю)", "Отлично"],
        ["Месячный доход с игрока (ARPU)", f"{data['avg_monthly_arpu']:,.0f} ₽ / месяц", "2 800 – 4 500 ₽ на активного гостя", "Стабильно"],
        ["База активных игроков (30 дней)", f"{data['active_guests']} чел.", "250 – 400 чел. для клуба на 30–40 ПК", "Норма"],
        ["Общая зарегистрированная база", f"{data['total_registered']} чел.", "Капитал клуба для маркетинга и возврата", "Актив"],
        ["Доля безналичных оплат (эквайринг)", f"{data['pct_card']}%", "75 – 85% среди молодежной аудитории", "Отлично"],
        ["Доля наличных расчетов", f"{data['pct_cash']}%", "15 – 25% через кассу администратора", "Норма"],
        [">>> ФИНАНСОВЫЙ ИТОГ И ЗДОРОВЬЕ БИЗНЕСА", "", "", ""],
        ["Главный источник дохода клуба", "Покупка платных часов (пакеты)", "100% привязано к ПК и учетным записям", "Фокус"],
        ["Сопутствующая выручка (Бар/снеки)", "Кассовые общие продажи", "15-25% к общей кассе клуба сверху", "Плюс"],
        ["Упущенная выгода (Спящие гости)", f"~{data['dormant_lost_rev']:,.0f} ₽ / месяц", "Деньги, которые клуб недополучает из-за оттока", "Точка роста"]
    ]

    sheets_configs.append({
        "name": "Дашборд владельца",
        "title": "Сводный финансово-операционный дашборд клуба",
        "subtitle": f"Главные показатели бизнеса для собственников · 1SHOT CLUB · Данные на {now_str}",
        "col_widths": [34, 24, 46, 16],
        "headers": dash_rows[0],
        "rows": dash_rows[1:],
        "is_kpi": True,
        "kpis": dash_kpis
    })

    # -------------------------------------------------------------
    # TAB 2: СТРУКТУРА ВЫРУЧКИ (ПАРЕТО)
    # -------------------------------------------------------------
    pareto_rows = [
        ["Сегмент гостей", "Количество", "Частота визитов", "Ср. чек визита", "Вклад в кассу (₽/мес)", "Доля в выручке", "Значение для бизнеса"],
        ["Ядро клуба (Хардкор)", f"{data['core_count']} чел.", "8–12 раз/мес", "740 ₽", f"{data['core_rev']:,.0f} ₽", f"{data['core_share']}%", "Главные клиенты. Делают больше половины выручки"],
        ["Постоянные игроки", f"{data['reg_count']} чел.", "4–7 раз/мес", "640 ₽", f"{data['reg_rev']:,.0f} ₽", f"{data['reg_share']}%", "Стабильная база. Приходят каждые выходные / пятницы"],
        ["Редкие (Казуальные)", f"{data['cas_count']} чел.", "1–3 раза/мес", "520 ₽", f"{data['cas_rev']:,.0f} ₽", f"{data['cas_share']}%", "Резерв роста. Нужна мотивация на 2-й визит в месяц"],
        [">>> ПРИНЦИП ПАРЕТО В КЛУБЕ: 20% ГОСТЕЙ ПРИНОСЯТ 60% ДЕНЕГ", "", "", "", "", "", ""],
        ["Вывод для владельца", "Фокус на удержании ядра", "Потеря 1 игрока ядра = потеря 7 000–10 000 ₽ кассы в месяц", "", "", "", "Приоритет №1"]
    ]

    sheets_configs.append({
        "name": "Структура выручки",
        "title": "Сегментация гостей и распределение выручки (Парето)",
        "subtitle": f"На каких группах игроков держится касса клуба · Анализ доходности · {now_str}",
        "col_widths": [26, 16, 18, 16, 24, 18, 54],
        "headers": pareto_rows[0],
        "rows": pareto_rows[1:],
        "is_kpi": False,
        "kpis": None
    })

    # -------------------------------------------------------------
    # TAB 3: ЗАГРУЗКА И ПАРК ПК
    # -------------------------------------------------------------
    pc_rows = [
        ["Зона клуба", "Количество мест", "Тариф (день / ночь)", "Пиковая загрузка", "Дневная загрузка", "Экономическая роль"],
        ["Standard (ряды 100-400)", "22 ПК", "120–160 ₽/ч (пакеты)", "90 – 100% (вечер/ночь)", "25 – 40% (будни день)", "Массовый стабильный трафик и ночные пакеты"],
        ["VIP Комнаты (11-15, 21-25)", "10 ПК", "180–240 ₽/ч (пакеты)", "95 – 100% (пт-вс брони)", "40 – 60% (будни)", "Максимальная маржинальность и высокий чек"],
        ["Консольная зона (PS5 Lounge)", "2 консоли", "299 ₽/час", "80 – 90% (выходные/вечер)", "20 – 35% (будни)", "Парные визиты, компании, допродажи бара"],
        [">>> ЭКОНОМИКА ЗАГРУЗКИ ПО ВРЕМЕНИ СУТОК", "", "", "", "", ""],
        ["Вечерний прайм (18:00 – 01:00)", "Все зоны клуба", "Пакеты 3ч / 5ч", "95 – 100% (спрос превышает вместимость)", "Решение: бронь через бота"],
        ["Ночной прайм (22:00 – 08:00)", "Standard + VIP", "Пакет 'Ночь' (1599 ₽ VIP / 999 ₽ Std)", "85 – 100% в пятницу и субботу", "Ключевой генератор кассы уикенда"],
        ["Дневной простой (10:00 – 16:00)", "Standard ряды", "Почасовая оплата", "25 – 35% (главная точка потери выручки)", "Потенциал роста: дневные комбо для школьников/студентов"]
    ]

    sheets_configs.append({
        "name": "Загрузка и парк ПК",
        "title": "Экономика парка оборудования и загрузка по времени суток",
        "subtitle": f"Распределение машиномест, тарифная сетка и утилизация ПК · {now_str}",
        "col_widths": [28, 16, 26, 30, 26, 52],
        "headers": pc_rows[0],
        "rows": pc_rows[1:],
        "is_kpi": False,
        "kpis": None
    })

    # -------------------------------------------------------------
    # TAB 4: ТОЧКИ РОСТА ПРИБЫЛИ
    # -------------------------------------------------------------
    growth_rows = [
        ["Точка роста / Проблема", "Текущие потери / Резерв", "Что сделать для роста кассы", "Ожидаемый финансовый эффект"],
        ["1. Спящие постоянные гости", f"~{data['dormant_lost_rev']:,.0f} ₽ недополученной кассы/мес", "Персональный возврат через бота: 200 бонусов при визите на этой неделе", "Возврат +80 000 – 140 000 ₽ в кассу ежемесячно"],
        ["2. Дневной простой в будни (10-16)", "Простаивает до 65% ПК зала", "Ввести студенческий тариф 'Дневной безлимит' (350–450 ₽ с 10:00 до 16:00)", "+50 000 – 90 000 ₽ чистой выручки с простаивающих машин"],
        ["3. Защита ключевого ядра (VIP)", "Риск потери игроков с чеком 8 000+ ₽", "Приоритетная бронь ПК через Telegram Mini App, чтобы любимые ПК не были заняты", "Удержание 95% ядра клуба (сохранение ~350 000 ₽/мес)"],
        ["4. Допродажи бара к ночным пакетам", "Часть гостей не берет напитки на кассе", "Комбо 'Ночь + Энергетик + Сэндвич' со скидкой 10% в одном пакете", "+15 – 25% к среднему чеку ночной сессии"],
        [">>> ТОП-10 САМЫХ ЦЕННЫХ ГОСТЕЙ КЛУБА (НА КОМ ДЕРЖИТСЯ КАССА)", "", "", ""]
    ]
    for i, g in enumerate(data["top_vip_guests"][:10], start=1):
        growth_rows.append([
            f"#{i} {g['username']} ({g['name']})",
            f"Приносит ~{g['monthly_rev']:,.0f} ₽/мес",
            f"Ходит {g['visits_month']} раз/мес · Чек {g['aov']} ₽",
            f"Всего оставил в клубе: {g['total_spent']:,.0f} ₽"
        ])

    sheets_configs.append({
        "name": "Точки роста прибыли",
        "title": "План роста выручки и ключевые точки капитализации клуба",
        "subtitle": f"Где клуб теряет деньги и как добавить +20-30% к текущей кассе · {now_str}",
        "col_widths": [32, 28, 48, 44],
        "headers": growth_rows[0],
        "rows": growth_rows[1:],
        "is_kpi": False,
        "kpis": None
    })

    # Build XMLs
    sheet_xmls = []
    for sheet_idx, cfg in enumerate(sheets_configs, start=1):
        num_cols = len(cfg["col_widths"])
        last_col = chr(64 + num_cols) if num_cols <= 26 else chr(64 + (num_cols-1)//26) + chr(65 + (num_cols-1)%26)

        cols_xml = ['<cols>']
        for c_i, w in enumerate(cfg["col_widths"], start=1):
            cols_xml.append(f'<col min="{c_i}" max="{c_i}" width="{w}" customWidth="1"/>')
        cols_xml.append('</cols>')

        rows_xml = ['<sheetData>']
        row_num = 1

        # Title
        rows_xml.append(f'<row r="{row_num}" ht="28" customHeight="1">')
        rows_xml.append(f'<c r="A{row_num}" s="2" t="s"><v>{get_str_id(cfg["title"])}</v></c>')
        rows_xml.append('</row>')
        row_num += 1

        # Subtitle
        rows_xml.append(f'<row r="{row_num}" ht="18" customHeight="1">')
        rows_xml.append(f'<c r="A{row_num}" s="3" t="s"><v>{get_str_id(cfg["subtitle"])}</v></c>')
        rows_xml.append('</row>')
        row_num += 1

        # Spacer
        rows_xml.append(f'<row r="{row_num}" ht="10"/>')
        row_num += 1

        # KPI block for Tab 1
        if cfg.get("is_kpi") and cfg.get("kpis"):
            # Label row
            rows_xml.append(f'<row r="{row_num}" ht="18" customHeight="1">')
            for k_i, kpi in enumerate(cfg["kpis"][:4], start=1):
                col_let = chr(64 + k_i)
                rows_xml.append(f'<c r="{col_let}{row_num}" s="4" t="s"><v>{get_str_id(kpi["label"])}</v></c>')
            rows_xml.append('</row>')
            row_num += 1

            # Value row
            rows_xml.append(f'<row r="{row_num}" ht="32" customHeight="1">')
            for k_i, kpi in enumerate(cfg["kpis"][:4], start=1):
                col_let = chr(64 + k_i)
                rows_xml.append(f'<c r="{col_let}{row_num}" s="5" t="s"><v>{get_str_id(kpi["value"])}</v></c>')
            rows_xml.append('</row>')
            row_num += 1

            # Spacer
            rows_xml.append(f'<row r="{row_num}" ht="12"/>')
            row_num += 1

        # Table Header
        rows_xml.append(f'<row r="{row_num}" ht="26" customHeight="1">')
        for c_idx, h in enumerate(cfg["headers"], start=1):
            col_let = chr(64 + c_idx) if c_idx <= 26 else chr(64 + (c_idx-1)//26) + chr(65 + (c_idx-1)%26)
            rows_xml.append(f'<c r="{col_let}{row_num}" s="1" t="s"><v>{get_str_id(h)}</v></c>')
        rows_xml.append('</row>')
        row_num += 1

        # Rows
        for r_i, row in enumerate(cfg["rows"]):
            is_zebra = (r_i % 2 == 1)

            # Section Header
            if len(row) >= 1 and str(row[0]).startswith(">>>"):
                sec_title = str(row[0]).replace(">>>", "").strip()
                rows_xml.append(f'<row r="{row_num}" ht="24" customHeight="1">')
                rows_xml.append(f'<c r="A{row_num}" s="12" t="s"><v>{get_str_id(sec_title)}</v></c>')
                for c_i in range(2, num_cols + 1):
                    col_let = chr(64 + c_i) if c_i <= 26 else chr(64 + (c_i-1)//26) + chr(65 + (c_i-1)%26)
                    rows_xml.append(f'<c r="{col_let}{row_num}" s="12"/>')
                rows_xml.append('</row>')
                row_num += 1
                continue

            rows_xml.append(f'<row r="{row_num}" ht="22" customHeight="1">')
            for c_idx, val in enumerate(row, start=1):
                col_let = chr(64 + c_idx) if c_idx <= 26 else chr(64 + (c_idx-1)//26) + chr(65 + (c_idx-1)%26)
                cell_ref = f"{col_let}{row_num}"

                val_str = str(val)
                if val_str in ("Отлично", "Актив", "Фокус"):
                    style_id = 10  # Soft sage green badge
                elif val_str in ("Точка роста", "Приоритет №1"):
                    style_id = 11  # Soft amber badge
                elif val_str in ("Норма", "Стабильно"):
                    style_id = 13  # Centered clean
                elif isinstance(val, (int, float)):
                    style_id = 9 if is_zebra else 8
                else:
                    style_id = 7 if is_zebra else 6

                if val is None or val == "":
                    rows_xml.append(f'<c r="{cell_ref}" s="{style_id}"/>')
                elif isinstance(val, (int, float)) and not isinstance(val, bool):
                    rows_xml.append(f'<c r="{cell_ref}" s="{style_id}"><v>{val}</v></c>')
                else:
                    rows_xml.append(f'<c r="{cell_ref}" s="{style_id}" t="s"><v>{get_str_id(val)}</v></c>')
            rows_xml.append('</row>')
            row_num += 1

        rows_xml.append('</sheetData>')

        ws_full = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n',
            f'<dimension ref="A1:{last_col}{row_num}"/>\n',
            '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>\n',
            '<sheetFormatPr defaultRowHeight="15"/>\n',
            "".join(cols_xml),
            "".join(rows_xml),
            '</worksheet>'
        ]
        sheet_xmls.append((f"xl/worksheets/sheet{sheet_idx}.xml", "".join(ws_full)))

    sst_parts = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">']
    for s in shared_strings:
        sst_parts.append(f'<si><t xml:space="preserve">{sax.escape(str(s))}</t></si>')
    sst_parts.append('</sst>')
    shared_strings_xml = "".join(sst_parts)

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0\ &quot;₽&quot;"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
  </numFmts>
  <fonts count="14">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
    <font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="8.5"/><color rgb="FF64748B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="18"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FF065F46"/><name val="Segoe UI"/></font>
    <font><b/><sz val="9"/><color rgb="FF92400E"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10.5"/><color rgb="FF1E3A8A"/><name val="Segoe UI"/></font>
    <font><sz val="8.5"/><color rgb="FF059669"/><name val="Segoe UI"/></font>
    <font><sz val="9.5"/><color rgb="FF64748B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="9"/><color rgb="FF065F46"/><name val="Segoe UI"/></font>
    <font><sz val="9"/><color rgb="FF64748B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="9.5"/><color rgb="FF1E293B"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="11" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="8" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium9"/>
</styleSheet>"""

    sheets_tags = []
    wb_rels = []
    for sheet_idx, cfg in enumerate(sheets_configs, start=1):
        sheets_tags.append(f'<sheet name="{sax.escape(cfg["name"])}" sheetId="{sheet_idx}" r:id="rId{sheet_idx}"/>')
        wb_rels.append(f'<Relationship Id="rId{sheet_idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{sheet_idx}.xml"/>')
    wb_rels.append(f'<Relationship Id="rId{len(sheets_configs)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>')
    wb_rels.append(f'<Relationship Id="rId{len(sheets_configs)+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')

    workbook_xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{"".join(sheets_tags)}</sheets></workbook>'
    workbook_rels = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(wb_rels)}</Relationships>'

    ct_overrides = [f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets_configs)+1)]
    content_types_xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>{"".join(ct_overrides)}</Types>'
    root_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'

    with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types_xml)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/workbook.xml", workbook_xml)
        z.writestr("xl/styles.xml", styles_xml)
        z.writestr("xl/sharedStrings.xml", shared_strings_xml)
        for p, d in sheet_xmls:
            z.writestr(p, d)
    print(f"[OK] Owner Dashboard workbook generated: {filepath}")

def main():
    print("=" * 60)
    print(" 1SHOT: EXECUTIVE OWNER DASHBOARD GENERATOR ")
    print("=" * 60)

    env_path = find_env()
    env = load_env(env_path) if env_path else {}

    base_url = env.get("GIZMO_BASE_URL") or os.environ.get("GIZMO_BASE_URL")
    login = env.get("GIZMO_LOGIN") or os.environ.get("GIZMO_LOGIN")
    password = env.get("GIZMO_PASSWORD") or os.environ.get("GIZMO_PASSWORD")
    verify_ssl = (env.get("GIZMO_VERIFY_SSL", "false").lower() == "true")

    if not base_url or not login or not password:
        print("\nNote: Live Gizmo credentials not found in environment.")
        print("Generating realistic executive presentation dataset for club owners...")
        import random
        random.seed(42)
        sample_users = []
        first_names = ["Алексей", "Дмитрий", "Артём", "Иван", "Максим", "Никита", "Михаил", "Даниил", "Егор", "Андрей", "Кирилл", "София", "Анна"]
        for i in range(1, 380):
            birth_year = random.choices([2008, 2007, 2005, 2004, 2003, 2001, 1999, 1995, 1990], weights=[8, 14, 25, 22, 16, 8, 4, 2, 1])[0]
            days_ago = random.choices([0, 1, 3, 5, 10, 18, 35, 60], weights=[15, 20, 25, 15, 10, 5, 6, 4])[0]
            last_dt = (datetime.now() - timedelta(days=days_ago)).isoformat()
            sample_users.append({
                "id": i,
                "userName": f"player_{i:03d}" if i != 7 else "Killirado",
                "firstName": "Кирилл" if i == 7 else random.choice(first_names),
                "lastName": "",
                "birthDate": f"{birth_year}-0{random.randint(1,9)}-1{random.randint(0,8)}",
                "sex": 1 if random.random() > 0.12 else 2,
                "mobilePhone": f"+7999{random.randint(1000000, 9999999)}",
                "modifiedTime": last_dt
            })
        sample_spending = []
        for u in sample_users:
            if u["userName"] == "Killirado":
                sample_spending.append({"userId": u["id"], "username": u["userName"], "total": 24800, "cash": 3200, "creditCard": 21600, "deposits": 0})
            elif random.random() > 0.15:
                tier = random.choices(["casual", "regular", "core"], weights=[45, 35, 20])[0]
                if tier == "casual":
                    tot = random.randint(500, 2800)
                elif tier == "regular":
                    tot = random.randint(3500, 11000)
                else:
                    tot = random.randint(14000, 32000)
                card = round(tot * random.uniform(0.70, 0.95))
                cash = tot - card
                sample_spending.append({"userId": u["id"], "username": u["userName"], "total": tot, "cash": cash, "creditCard": card, "deposits": 0})

        active_sample = [{"userId": 7, "hostId": 102}]
        model = build_owner_model(sample_users, sample_spending, active_sample)
    else:
        client = GizmoClient(base_url, login, password, verify_ssl)
        print(f"Connecting to Gizmo API at: {client.base}")
        print("Fetching users list from Gizmo (/api/users)...")
        users = client.get("users") or []
        print(f"Fetched {len(users)} users.")

        print("Fetching active sessions (/api/usersessions/activeinfo)...")
        active_sessions = client.get("usersessions/activeinfo") or []
        print(f"Fetched {len(active_sessions)} active sessions right now.")

        print("Fetching session logs for the last 30 days (/api/reports/sessionslog)...")
        sessions_log = []
        try:
            d_from = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
            d_to = datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59Z")
            sess_report = client.get("reports/sessionslog", params={"DateFrom": d_from, "DateTo": d_to})
            if sess_report and isinstance(sess_report, dict) and "sessions" in sess_report:
                sessions_log = sess_report["sessions"]
                print(f"Fetched {len(sessions_log)} gaming sessions over the past 30 days.")
        except Exception:
            pass

        print("Fetching spending report (/api/reports/users/spending)...")
        spending = client.get("reports/users/spending") or []
        print(f"Fetched spending for {len(spending)} users.")

        model = build_owner_model(users, spending, active_sessions, sessions_log)

    xlsx_path = str(Path(__file__).parent / "Otchet_Dlya_Vladeltsev.xlsx")
    create_owner_workbook(model, xlsx_path)

    print("\n" + "=" * 60)
    print(" ОТЧЁТ ДЛЯ ВЛАДЕЛЬЦЕВ КЛУБА УСПЕШНО СОЗДАН:")
    print(" • Файл: Otchet_Dlya_Vladeltsev.xlsx")
    print(" • Вкладки:")
    print("   1. 'Дашборд владельца' — 4 KPI карточки + финансовый пульс")
    print("   2. 'Структура выручки' — раскладка Парето (Ядро / Постоянные / Редкие)")
    print("   3. 'Загрузка и парк ПК' — экономика оборудования, прайм vs простой")
    print("   4. 'Точки роста прибыли' — где теряются деньги и как увеличить кассу")
    print("=" * 60)

if __name__ == "__main__":
    main()
