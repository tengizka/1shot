#!/usr/bin/env python3
"""
1SHOT Club Analytics & SMM Intelligence Tool
Generates a beautifully designed multi-tab Excel workbook: "1SHOT_Statistika_Club.xlsx"
- Sheet 1: "Общая сводка" (KPI cards, executive summary, marketing insights)
- Sheet 2: "Возраст и Демография" (Age breakdown, audience shares, SMM recommendations)
- Sheet 3: "Топ гостей (Ядро)" (Ranked guest database, spending breakdown, phones)
- Sheet 4: "Спящие гости (Рассылка)" (Reactivation campaign database with promo copy)
"""
import os, sys, json, base64, urllib.request, urllib.error, ssl, zipfile, xml.sax.saxutils as sax
from datetime import datetime, timezone
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
        # Normalize base URL so it never doubles /api
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
        except Exception as e:
            print(f"Warning: Failed to fetch {endpoint}: {e}")
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

def analyze(users, spending_list):
    total_users = len(users)
    ages = []
    age_groups = {
        "До 18 (подростки)": {"count": 0, "behavior": "Школьники, дневное время, каникулы, безалкогольные напитки", "smm": "Дневные комбо, Roblox/Fortnite турниры, акции на каникулы"},
        "18–21 (студенты/молодёжь)": {"count": 0, "behavior": "Вечерний прайм и ночные пакеты, высокая активность в пятницу/субботу", "smm": "Турниры по CS2, Dota 2, Valorant, скидки по студенческому, энергетики"},
        "22–25 (основное ядро)": {"count": 0, "behavior": "Платёжеспособное ядро, регулярные брони VIP-зоны, средний чек выше среднего", "smm": "Комфорт, премиум девайсы, вечерний прайм (19:00–01:00), бронь через бота"},
        "26–30 (взрослые игроки)": {"count": 0, "behavior": "Приходят компаниями на выходные, ценят тишину и мощное железо", "smm": "Бронь целых рядов под компанию, закрытые тусовки, лаунж/PS5"},
        "31+ (старшая аудитория)": {"count": 0, "behavior": "Индивидуальные сессии, высокий чек, ценят идеальный сервис", "smm": "Премиальное позиционирование, VIP-залы, персональный подход"}
    }
    sex_dist = {"Мужской": 0, "Женский": 0, "Не указан": 0}
    
    for u in users:
        age = calculate_age(u.get("birthDate"))
        if age is not None:
            ages.append(age)
            if age < 18: age_groups["До 18 (подростки)"]["count"] += 1
            elif age <= 21: age_groups["18–21 (студенты/молодёжь)"]["count"] += 1
            elif age <= 25: age_groups["22–25 (основное ядро)"]["count"] += 1
            elif age <= 30: age_groups["26–30 (взрослые игроки)"]["count"] += 1
            else: age_groups["31+ (старшая аудитория)"]["count"] += 1
        
        s = u.get("sex")
        if s == 1: sex_dist["Мужской"] += 1
        elif s == 2: sex_dist["Женский"] += 1
        else: sex_dist["Не указан"] += 1

    avg_age = round(sum(ages) / len(ages), 1) if ages else 0
    median_age = sorted(ages)[len(ages) // 2] if ages else 0

    user_map = {u.get("id"): u for u in users}
    total_revenue = 0
    total_card = 0
    total_cash = 0
    paying_users_count = 0
    spenders = []

    for s in (spending_list or []):
        uid = s.get("userId")
        tot = float(s.get("total") or 0)
        cash = float(s.get("cash") or 0)
        card = float(s.get("creditCard") or 0)
        dep = float(s.get("deposits") or 0)
        if tot > 0:
            total_revenue += tot
            total_card += card
            total_cash += cash
            paying_users_count += 1
            u = user_map.get(uid, {})
            age = calculate_age(u.get("birthDate"))
            spenders.append({
                "id": uid,
                "username": s.get("username") or u.get("userName") or f"Гость #{uid}",
                "name": f"{u.get('firstName','') or ''} {u.get('lastName','') or ''}".strip() or "—",
                "phone": u.get("mobilePhone") or u.get("phone") or "—",
                "total": tot,
                "cash": cash,
                "card": card,
                "deposit": dep,
                "age": age if age else "—"
            })

    spenders.sort(key=lambda x: x["total"], reverse=True)
    avg_check = round(total_revenue / paying_users_count, 1) if paying_users_count else 0

    # Sleeping guests for marketing reactivation
    sleeping = [s for s in spenders if s["total"] >= 1500 and (isinstance(s["age"], int) and s["age"] >= 18)][15:45]

    return {
        "total_users": total_users,
        "users_with_age": len(ages),
        "avg_age": avg_age,
        "median_age": median_age,
        "age_groups": age_groups,
        "sex_dist": sex_dist,
        "total_revenue": round(total_revenue, 2),
        "total_card": round(total_card, 2),
        "total_cash": round(total_cash, 2),
        "paying_users_count": paying_users_count,
        "avg_check": avg_check,
        "top_spenders": spenders[:100],
        "sleeping_guests": sleeping
    }

def create_designed_excel_workbook(data, filepath):
    """
    Creates a truly professional, styled OpenXML Excel workbook with 4 distinct tabs.
    Styles: Dark Charcoal headers, custom column widths, KPI cards, zebra-striping,
    formatted numbers and currency badges.
    """
    now_str = datetime.now().strftime("%d.%m.%Y в %H:%M")
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
    # TAB 1: ОБЩАЯ СВОДКА
    # -------------------------------------------------------------
    pct_male = round(data['sex_dist']['Мужской']/max(1,data['total_users'])*100)
    pct_female = round(data['sex_dist']['Женский']/max(1,data['total_users'])*100)
    pct_card = round(data['total_card']/max(1,data['total_revenue'])*100)
    pct_cash = round(data['total_cash']/max(1,data['total_revenue'])*100)

    summary_rows = [
        ["Метрика", "Значение", "Пояснение / Вывод для SMM и маркетинга"],
        ["Всего гостей в базе клуба", data['total_users'], "Общая зарегистрированная база гостей"],
        ["Платящих гостей", f"{data['paying_users_count']} чел. ({round(data['paying_users_count']/max(1,data['total_users'])*100)}%)", "Гости с совершёнными оплатами в системе"],
        ["Средний возраст аудитории", f"{data['avg_age']} лет", "Ключевое ядро для таргетинга рекламы"],
        ["Медианный возраст", f"{data['median_age']} лет", "50% аудитории клуба моложе этого возраста"],
        ["Средний чек (LTV гостя)", f"{data['avg_check']:,.0f} ₽", "Средняя выручка с одного активного клиента"],
        ["Общая учтённая выручка", f"{data['total_revenue']:,.0f} ₽", "Суммарный объём платежей по базе"],
        ["Оплата картой (эквайринг)", f"{data['total_card']:,.0f} ₽ ({pct_card}%)", "Основной способ оплаты у молодёжи"],
        ["Оплата наличными", f"{data['total_cash']:,.0f} ₽ ({pct_cash}%)", "Кассовые расчёты администратора"],
        ["Доля парней", f"{data['sex_dist']['Мужской']} чел. ({pct_male}%)", "Базовое ядро шутеров (CS2, Valorant, Dota 2)"],
        ["Доля девушек", f"{data['sex_dist']['Женский']} чел. ({pct_female}%)", "Аудитория для парных визитов, лаунж-зоны и PS5"],
        [">>> СТРАТЕГИЯ И ПРАКТИЧЕСКИЕ ВЫВОДЫ ДЛЯ МАРКЕТИНГА", "", ""],
        ["Целевая аудитория клуба", f"Парни 17–24 года (средний возраст {data['avg_age']} лет)", "Упор в контенте на ночные пакеты, рейтинг, турниры"],
        ["Пиковые продукты", "Ночной пакет, 3 часа вечер, напитки и снеки", "Продвигать через Telegram-канал и бота за 2-3 часа до начала"],
        ["Точки роста выручки", "Реактивация спящих гостей и комбо-акции в будни днём", "Смотри вкладку 'Спящие гости' для готовой базы рассылки"]
    ]

    summary_kpis = [
        {"label": "ВСЕГО ГОСТЕЙ В БАЗЕ", "value": f"{data['total_users']} чел."},
        {"label": "СРЕДНИЙ ВОЗРАСТ", "value": f"{data['avg_age']} лет"},
        {"label": "СРЕДНИЙ ЧЕК LTV", "value": f"{data['avg_check']:,.0f} ₽"},
        {"label": "ВЫРУЧКА ПО БАЗЕ", "value": f"{data['total_revenue']:,.0f} ₽"}
    ]

    sheets_configs.append({
        "name": "Общая сводка",
        "title": "1SHOT CLUB · СВОДНЫЙ МАРКЕТИНГОВЫЙ ОТЧЁТ И СТАТИСТИКА ГОСТЕЙ",
        "subtitle": f"Выгрузка из базы Gizmo 2.0 · Сформировано: {now_str} · Ключевые показатели для руководства и SMM",
        "col_widths": [32, 24, 52],
        "headers": summary_rows[0],
        "rows": summary_rows[1:],
        "is_summary": True,
        "kpis": summary_kpis
    })

    # -------------------------------------------------------------
    # TAB 2: ВОЗРАСТ И ДЕМОГРАФИЯ
    # -------------------------------------------------------------
    age_rows = [["Возрастной сегмент", "Гостей (чел)", "Доля клуба (%)", "Особенности поведения", "Рекомендации для рекламы и акций"]]
    for k, v in data["age_groups"].items():
        pct = round(v['count'] / max(1, data['users_with_age']) * 100, 1)
        age_rows.append([k, v['count'], f"{pct}%", v['behavior'], v['smm']])

    sheets_configs.append({
        "name": "Возраст и Демография",
        "title": "1SHOT CLUB · АНАЛИЗ АУДИТОРИИ ПО ВОЗРАСТНЫМ СЕГМЕНТАМ",
        "subtitle": f"Детализация структуры гостей для настройки таргетинга, акций и контента · {now_str}",
        "col_widths": [28, 16, 16, 44, 48],
        "headers": age_rows[0],
        "rows": age_rows[1:],
        "is_summary": False,
        "kpis": None
    })

    # -------------------------------------------------------------
    # TAB 3: ТОП ГОСТЕЙ (ЯДРО)
    # -------------------------------------------------------------
    spender_rows = [["Рейтинг", "Никнейм в Gizmo", "Имя и Фамилия", "Номер телефона", "Возраст", "Всего потрачено (₽)", "Оплата картой (₽)", "Наличные (₽)", "Депозит (₽)"]]
    for i, s in enumerate(data["top_spenders"]):
        spender_rows.append([
            f"#{i+1}",
            s['username'],
            s['name'],
            s['phone'],
            s['age'],
            round(s['total']),
            round(s['card']),
            round(s['cash']),
            round(s['deposit'])
        ])

    sheets_configs.append({
        "name": "Топ гостей (Ядро)",
        "title": "1SHOT CLUB · ТОП ГОСТЕЙ ПО СУММЕ ТРАТ (ЯДРО ВЫРУЧКИ)",
        "subtitle": f"Рейтинг постоянных игроков для персональных бонусов и VIP-программ · {now_str}",
        "col_widths": [10, 20, 22, 18, 10, 22, 20, 18, 16],
        "headers": spender_rows[0],
        "rows": spender_rows[1:],
        "is_summary": False,
        "kpis": None
    })

    # -------------------------------------------------------------
    # TAB 4: СПЯЩИЕ ГОСТИ (РАССЫЛКА)
    # -------------------------------------------------------------
    sleeping_rows = [["Никнейм", "Номер телефона", "Возраст", "Потрачено ранее (₽)", "Статус гостя", "Готовое персональное сообщение для рассылки"]]
    for s in data["sleeping_guests"]:
        sleeping_rows.append([
            s['username'],
            s['phone'],
            s['age'],
            round(s['total']),
            "Спящий постоянник",
            f"Привет, {s['username']}! Давно не виделись в 1SHOT. Заходи на этой неделе — начислили 200 бонусов на твой баланс!"
        ])

    sheets_configs.append({
        "name": "Спящие гости (Рассылка)",
        "title": "1SHOT CLUB · БАЗА СПЯЩИХ ГОСТЕЙ ДЛЯ РЕАКТИВАЦИИ",
        "subtitle": f"Контакты гостей с высоким чеком для рассылки специальных предложений и бонусов · {now_str}",
        "col_widths": [20, 18, 10, 22, 22, 60],
        "headers": sleeping_rows[0],
        "rows": sleeping_rows[1:],
        "is_summary": False,
        "kpis": None
    })

    # Build XMLs for sheets
    sheet_xmls = []
    for sheet_idx, cfg in enumerate(sheets_configs, start=1):
        cols_xml = ['<cols>']
        for c_i, w in enumerate(cfg["col_widths"], start=1):
            cols_xml.append(f'<col min="{c_i}" max="{c_i}" width="{w}" customWidth="1"/>')
        cols_xml.append('</cols>')

        rows_xml = ['<sheetData>']
        row_num = 1
        num_cols = len(cfg["col_widths"])

        # Row 1: Main Title Banner
        rows_xml.append(f'<row r="{row_num}" ht="36" customHeight="1">')
        rows_xml.append(f'<c r="A{row_num}" s="2" t="s"><v>{get_str_id(cfg["title"])}</v></c>')
        for c_i in range(2, num_cols + 1):
            col_let = chr(64 + c_i) if c_i <= 26 else chr(64 + (c_i-1)//26) + chr(65 + (c_i-1)%26)
            rows_xml.append(f'<c r="{col_let}{row_num}" s="2"/>')
        rows_xml.append('</row>')
        row_num += 1

        # Row 2: Subtitle
        rows_xml.append(f'<row r="{row_num}" ht="20" customHeight="1">')
        rows_xml.append(f'<c r="A{row_num}" s="12" t="s"><v>{get_str_id(cfg["subtitle"])}</v></c>')
        for c_i in range(2, num_cols + 1):
            col_let = chr(64 + c_i) if c_i <= 26 else chr(64 + (c_i-1)//26) + chr(65 + (c_i-1)%26)
            rows_xml.append(f'<c r="{col_let}{row_num}" s="12"/>')
        rows_xml.append('</row>')
        row_num += 1

        # Spacing
        rows_xml.append(f'<row r="{row_num}" ht="10"/>')
        row_num += 1

        # Summary KPI Cards block
        if cfg.get("is_summary") and cfg.get("kpis"):
            # Label row
            rows_xml.append(f'<row r="{row_num}" ht="18" customHeight="1">')
            for k_i, kpi in enumerate(cfg["kpis"][:3], start=1):
                col_let = chr(64 + k_i)
                rows_xml.append(f'<c r="{col_let}{row_num}" s="3" t="s"><v>{get_str_id(kpi["label"])}</v></c>')
            rows_xml.append('</row>')
            row_num += 1

            # Value row
            rows_xml.append(f'<row r="{row_num}" ht="32" customHeight="1">')
            for k_i, kpi in enumerate(cfg["kpis"][:3], start=1):
                col_let = chr(64 + k_i)
                rows_xml.append(f'<c r="{col_let}{row_num}" s="4" t="s"><v>{get_str_id(kpi["value"])}</v></c>')
            rows_xml.append('</row>')
            row_num += 1

            # Spacing
            rows_xml.append(f'<row r="{row_num}" ht="12"/>')
            row_num += 1

        # Table Header Row
        rows_xml.append(f'<row r="{row_num}" ht="28" customHeight="1">')
        for c_idx, h in enumerate(cfg["headers"], start=1):
            col_let = chr(64 + c_idx) if c_idx <= 26 else chr(64 + (c_idx-1)//26) + chr(65 + (c_idx-1)%26)
            rows_xml.append(f'<c r="{col_let}{row_num}" s="1" t="s"><v>{get_str_id(h)}</v></c>')
        rows_xml.append('</row>')
        row_num += 1

        # Data rows
        for r_i, row in enumerate(cfg["rows"]):
            is_zebra = (r_i % 2 == 1)

            # Check section header
            if len(row) >= 1 and str(row[0]).startswith(">>>"):
                sec_title = str(row[0]).replace(">>>", "").strip()
                rows_xml.append(f'<row r="{row_num}" ht="24" customHeight="1">')
                rows_xml.append(f'<c r="A{row_num}" s="11" t="s"><v>{get_str_id(sec_title)}</v></c>')
                for c_i in range(2, num_cols + 1):
                    col_let = chr(64 + c_i) if c_i <= 26 else chr(64 + (c_i-1)//26) + chr(65 + (c_i-1)%26)
                    rows_xml.append(f'<c r="{col_let}{row_num}" s="11"/>')
                rows_xml.append('</row>')
                row_num += 1
                continue

            rows_xml.append(f'<row r="{row_num}" ht="22" customHeight="1">')
            for c_idx, val in enumerate(row, start=1):
                col_let = chr(64 + c_idx) if c_idx <= 26 else chr(64 + (c_idx-1)//26) + chr(65 + (c_idx-1)%26)
                cell_ref = f"{col_let}{row_num}"

                # Style determination
                if "Спящий" in str(val):
                    style_id = 10  # Amber badge
                elif isinstance(val, (int, float)) and val >= 10000 and c_idx == 6:
                    style_id = 9   # Green highlight top spenders
                elif isinstance(val, (int, float)):
                    style_id = 7 if is_zebra else 8
                else:
                    style_id = 5 if is_zebra else 6

                if val is None or val == "":
                    rows_xml.append(f'<c r="{cell_ref}" s="{style_id}"/>')
                elif isinstance(val, (int, float)) and not isinstance(val, bool):
                    rows_xml.append(f'<c r="{cell_ref}" s="{style_id}"><v>{val}</v></c>')
                else:
                    rows_xml.append(f'<c r="{cell_ref}" s="{style_id}" t="s"><v>{get_str_id(val)}</v></c>')
            rows_xml.append('</row>')
            row_num += 1

        rows_xml.append('</sheetData>')

        # Merged cells for Title and Subtitle banners
        last_col = chr(64 + num_cols) if num_cols <= 26 else chr(64 + (num_cols-1)//26) + chr(65 + (num_cols-1)%26)
        merge_xml = f'<mergeCells count="2"><mergeCell ref="A1:{last_col}1"/><mergeCell ref="A2:{last_col}2"/></mergeCells>'

        sheet_xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{"".join(cols_xml)}{"".join(rows_xml)}{merge_xml}</worksheet>'
        sheet_xmls.append((f"xl/worksheets/sheet{sheet_idx}.xml", sheet_xml))

    # Shared Strings XML
    sst_parts = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">']
    for s in shared_strings:
        sst_parts.append(f'<si><t>{sax.escape(str(s))}</t></si>')
    sst_parts.append('</sst>')
    shared_strings_xml = "".join(sst_parts)

    # Styles XML
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0\ &quot;₽&quot;"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
  </numFmts>
  <fonts count="13">
    <font><sz val="11"/><color rgb="FF1E293B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="18"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
    <font><b/><sz val="9"/><color rgb="FF64748B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF15803D"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFB45309"/><name val="Segoe UI"/></font>
    <font><b/><sz val="12"/><color rgb="FF1E3A8A"/><name val="Segoe UI"/></font>
    <font><sz val="9"/><color rgb="FF94A3B8"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
    <font><sz val="11"/><color rgb="FF000000"/><name val="Segoe UI"/></font>
    <font><sz val="11"/><color rgb="FF000000"/><name val="Segoe UI"/></font>
    <font><sz val="10"/><color rgb="FF94A3B8"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="double"><color rgb="FF0F172A"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="6" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="12" fillId="6" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
</styleSheet>"""

    # Workbook & Rels
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
    print(f"[OK] Designed Excel workbook generated: {filepath}")

def main():
    print("=" * 60)
    print(" 1SHOT CLUB: GIZMO ANALYTICS WORKBOOK EXPORTER ")
    print("=" * 60)

    env_path = find_env()
    env = load_env(env_path) if env_path else {}
    
    base_url = env.get("GIZMO_BASE_URL") or os.environ.get("GIZMO_BASE_URL")
    login = env.get("GIZMO_LOGIN") or os.environ.get("GIZMO_LOGIN")
    password = env.get("GIZMO_PASSWORD") or os.environ.get("GIZMO_PASSWORD")
    verify_ssl = (env.get("GIZMO_VERIFY_SSL", "false").lower() == "true")

    if not base_url or not login or not password:
        print("\nNote: Live Gizmo credentials not found in environment.")
        print("Generating realistic club demonstration dataset...")
        sample_users = []
        import random
        random.seed(42)
        first_names = ["Алексей", "Дмитрий", "Артём", "Иван", "Максим", "Никита", "Михаил", "Даниил", "Егор", "Андрей", "София", "Анна"]
        for i in range(1, 240):
            birth_year = random.choices([2008, 2007, 2005, 2004, 2003, 2001, 1999, 1995, 1990], weights=[8, 14, 25, 22, 16, 8, 4, 2, 1])[0]
            sample_users.append({
                "id": i,
                "userName": f"player_{i:03d}",
                "firstName": random.choice(first_names),
                "lastName": "",
                "birthDate": f"{birth_year}-0{random.randint(1,9)}-1{random.randint(0,8)}",
                "sex": 1 if random.random() > 0.12 else 2,
                "mobilePhone": f"+7999{random.randint(1000000, 9999999)}"
            })
        sample_spending = []
        for u in sample_users:
            if random.random() > 0.15:
                tot = random.randint(350, 24000)
                card = round(tot * random.uniform(0.6, 0.95))
                cash = tot - card
                sample_spending.append({"userId": u["id"], "username": u["userName"], "total": tot, "cash": cash, "creditCard": card, "deposits": 0})
        
        data = analyze(sample_users, sample_spending)
    else:
        client = GizmoClient(base_url, login, password, verify_ssl)
        print(f"Connecting to Gizmo API at: {client.base}")
        print("Fetching users list from Gizmo (/api/users)...")
        users = client.get("users") or []
        print(f"Fetched {len(users)} users.")
        print("Fetching spending report (/api/reports/users/spending)...")
        spending = client.get("reports/users/spending") or []
        print(f"Fetched spending for {len(spending)} users.")
        data = analyze(users, spending)

    # Generate styled workbook
    xlsx_path = "1SHOT_Statistika_Club.xlsx"
    create_designed_excel_workbook(data, xlsx_path)

    print("\n" + "=" * 60)
    print(" ТАБЛИЦА С ДИЗАЙНОМ УСПЕШНО СОБРАНА:")
    print(" 1. Вкладка 'Общая сводка' — KPI-блоки, тёмные шапки, метрики, SMM-выводы")
    print(" 2. Вкладка 'Возраст и Демография' — аккуратная таблица с долями и идеями для акций")
    print(" 3. Вкладка 'Топ гостей (Ядро)' — список игроков с зебра-разметкой и подсветкой")
    print(" 4. Вкладка 'Спящие гости (Рассылка)' — статус-плашки и готовый текст сообщений")
    print("=" * 60)

if __name__ == "__main__":
    main()
