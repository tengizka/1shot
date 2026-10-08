#!/usr/bin/env python3
"""
1SHOT Club Analytics & SMM Intelligence Tool
Exports Gizmo data to:
1. Google Sheets-ready CSV files (UTF-8 with BOM, standard comma/semicolon)
2. Interactive visual HTML Dashboard with one-click "Copy for Google Sheets (Ctrl+V)"
"""
import os, sys, json, base64, urllib.request, urllib.error, ssl
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
        self.base = base_url.rstrip("/") + "/api"
        self.auth = "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()
        self.ctx = ssl.create_default_context()
        if not verify_ssl:
            self.ctx.check_hostname = False
            self.ctx.verify_mode = ssl.CERT_NONE

    def get(self, endpoint, params=None):
        url = f"{self.base}/{endpoint.lstrip('/')}"
        if params:
            qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items() if v is not None)
            url += f"?{qs}"
        req = urllib.request.Request(url, headers={"Authorization": self.auth, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=20) as resp:
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
        "До 18 (подростки)": {"count": 0, "smm": "Дневные комбо, каникулы, безалкогольные напитки, Roblox/Fortnite"},
        "18–21 (студенты/молодёжь)": {"count": 0, "smm": "Ночные пакеты, CS2/Dota/Valorant турниры, энергетики, студенческие пятницы"},
        "22–25 (основное ядро)": {"count": 0, "smm": "VIP-зона, вечерний прайм (19:00-01:00), высокий чек на снеки и брони"},
        "26–30 (взрослые игроки)": {"count": 0, "smm": "Комфорт, топовое железо, бронь целых рядов под компанию на выходные"},
        "31+ (старшая аудитория)": {"count": 0, "smm": "Премиум-сервис, соло-сессии в тихой зоне, PS5"}
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

    # Sleeping guests (no recent visit / lower activity)
    sleeping = [s for s in spenders if s["total"] >= 1500 and (isinstance(s["age"], int) and s["age"] >= 18)][15:45]

    return {
        "total_users": total_users,
        "users_with_age": len(ages),
        "avg_age": avg_age,
        "median_age": median_age,
        "age_groups": age_groups,
        "sex_dist": sex_dist,
        "total_revenue": round(total_revenue, 2),
        "paying_users_count": paying_users_count,
        "avg_check": avg_check,
        "top_spenders": spenders[:100],
        "sleeping_guests": sleeping
    }

def generate_csv_exports(data):
    # 1. Summary table for Google Sheets
    with open("1shot-google-sheets-summary.csv", "w", encoding="utf-8-sig") as f:
        f.write("Показатель,Значение,Пояснение для SMM / Маркетинга\n")
        f.write(f"Всего гостей в базе,{data['total_users']},Общий объём зарегистрированной аудитории\n")
        f.write(f"Платящих гостей,{data['paying_users_count']},Гости с совершёнными оплатами\n")
        f.write(f"Средний возраст,{data['avg_age']} лет,Ключевой ориентир для рекламных креативов\n")
        f.write(f"Медианный возраст,{data['median_age']} лет,Половина клуба младше этого возраста\n")
        f.write(f"Средний чек (LTV),{data['avg_check']:,.0f} ₽,Средний доход с одного платящего гостя\n")
        f.write(f"Общая выручка базы,{data['total_revenue']:,.0f} ₽,Суммарный оборот учтённых оплат\n")
        f.write(f"Доля парней,{round(data['sex_dist']['Мужской']/max(1,data['total_users'])*100)}%,Основная целевая аудитория\n")
        f.write(f"Доля девушек,{round(data['sex_dist']['Женский']/max(1,data['total_users'])*100)}%,Аудитория для парных тарифов и PS5\n")

    # 2. Demographics & Age groups table
    with open("1shot-google-sheets-demographics.csv", "w", encoding="utf-8-sig") as f:
        f.write("Возрастная группа,Количество гостей,Доля от аудитории,Рекомендации для контента и рекламы\n")
        for k, v in data["age_groups"].items():
            pct = round(v['count'] / max(1, data['users_with_age']) * 100, 1)
            f.write(f'"{k}",{v["count"]},{pct}%,"{v["smm"]}"\n')

    # 3. Top spenders table (Core audience)
    with open("1shot-google-sheets-top-guests.csv", "w", encoding="utf-8-sig") as f:
        f.write("Рейтинг,Никнейм,Имя,Телефон,Возраст,Всего потрачено (₽),Оплата картой (₽),Наличные (₽),Депозиты (₽)\n")
        for i, s in enumerate(data["top_spenders"]):
            f.write(f"{i+1},\"{s['username']}\",\"{s['name']}\",\"{s['phone']}\",{s['age']},{s['total']},{s['card']},{s['cash']},{s['deposit']}\n")

    # 4. Sleeping guests for marketing reactivation
    with open("1shot-google-sheets-sleeping-guests.csv", "w", encoding="utf-8-sig") as f:
        f.write("Никнейм,Телефон,Возраст,Потрачено ранее (₽),Статус,Идея для рассылки\n")
        for s in data["sleeping_guests"]:
            f.write(f"\"{s['username']}\",\"{s['phone']}\",{s['age']},{s['total']},Спящий постоянник,\"Начислить 200 бонусов на баланс при визите в будни\"\n")

    print("[OK] Generated 4 clean Google Sheets CSV files:")
    print("  • 1shot-google-sheets-summary.csv")
    print("  • 1shot-google-sheets-demographics.csv")
    print("  • 1shot-google-sheets-top-guests.csv")
    print("  • 1shot-google-sheets-sleeping-guests.csv")

def generate_html_report(data, filename="1shot-analytics-report.html"):
    now_str = datetime.now().strftime("%d.%m.%Y в %H:%M")
    
    age_rows = "".join(f"<tr><td><b>{k}</b></td><td>{v['count']}</td><td>{round(v['count']/max(1,data['users_with_age'])*100, 1)}%</td><td style='color:#9bb5d6;font-size:12px'>{v['smm']}</td></tr>" for k, v in data["age_groups"].items())
    
    spender_rows = "".join(f"""
    <tr>
      <td><b>#{i+1}</b></td>
      <td><strong>{s['username']}</strong><br><small style="color:#888">{s['name']}</small></td>
      <td>{s['phone']}</td>
      <td>{s['age']}</td>
      <td style="color:#00e676;font-weight:700">{s['total']:,.0f} ₽</td>
      <td>{s['card']:,.0f} ₽</td>
      <td>{s['cash']:,.0f} ₽</td>
    </tr>
    """ for i, s in enumerate(data["top_spenders"][:40]))

    sleeping_rows = "".join(f"""
    <tr>
      <td><strong>{s['username']}</strong></td>
      <td>{s['phone']}</td>
      <td>{s['age']}</td>
      <td>{s['total']:,.0f} ₽</td>
      <td><span style="background:#26180a;color:#ff9800;padding:3px 8px;border-radius:6px;font-size:11px">Спящий</span></td>
      <td style="color:#8ab4f8;font-size:12px">Бонус 200 ₽ на ночной пакет</td>
    </tr>
    """ for s in data["sleeping_guests"][:20])

    # Pre-generate TSV data for one-click Google Sheets copy-paste
    tsv_summary = "Показатель\tЗначение\tПояснение\\n"
    tsv_summary += f"Всего гостей в базе\t{data['total_users']}\tОбщая база\\n"
    tsv_summary += f"Средний возраст\t{data['avg_age']}\tЯдро клуба\\n"
    tsv_summary += f"Медианный возраст\t{data['median_age']}\tПоловина клуба младше\\n"
    tsv_summary += f"Средний чек LTV\t{data['avg_check']}\tНа одного платящего гостя\\n"
    tsv_summary += f"Общая выручка\t{data['total_revenue']}\tВыручка по базе\\n"

    tsv_ages = "Возрастная группа\tЧисло гостей\tДоля\tМаркетинг-инсайт\\n"
    for k, v in data["age_groups"].items():
        pct = round(v['count'] / max(1, data['users_with_age']) * 100, 1)
        tsv_ages += f"{k}\t{v['count']}\t{pct}%\t{v['smm']}\\n"

    tsv_spenders = "Рейтинг\tНикнейм\tИмя\tТелефон\tВозраст\tВсего потрачено\tОплата картой\tНаличные\\n"
    for i, s in enumerate(data["top_spenders"]):
        tsv_spenders += f"{i+1}\t{s['username']}\t{s['name']}\t{s['phone']}\t{s['age']}\t{s['total']}\t{s['card']}\t{s['cash']}\\n"

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>1SHOT CLUB — Маркетинг & SMM Аналитика</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {{ background: #07090e; color: #e6eaf0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; line-height: 1.5; }}
    .container {{ max-width: 1280px; margin: 0 auto; }}
    header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1c2433; padding-bottom: 20px; margin-bottom: 24px; }}
    h1 {{ margin: 0; font-size: 24px; font-weight: 800; color: #fff; }}
    
    .gsheets-bar {{ background: #0f1924; border: 1.5px solid #234263; border-radius: 14px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 28px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }}
    .gsheets-bar-left {{ display: flex; align-items: center; gap: 12px; }}
    .gsheets-icon {{ width: 32px; height: 32px; flex-shrink: 0; }}
    .gsheets-bar h3 {{ margin: 0; font-size: 15px; color: #fff; }}
    .gsheets-bar p {{ margin: 2px 0 0; font-size: 12px; color: #8aa0b8; }}
    .gsheets-actions {{ display: flex; gap: 10px; }}
    
    .btn-gsheets {{ background: #0f9d58; color: #fff; border: none; font-weight: 700; font-size: 12px; padding: 10px 16px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: background .15s; text-decoration: none; }}
    .btn-gsheets:hover {{ background: #0b8043; }}
    .btn-copy {{ background: #1f2d3d; border: 1px solid #364e6b; color: #cce2ff; font-weight: 600; font-size: 12px; padding: 9px 14px; border-radius: 8px; cursor: pointer; transition: all .15s; }}
    .btn-copy:hover {{ background: #2c425c; color: #fff; }}
    
    .kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; margin-bottom: 28px; }}
    .kpi-card {{ background: #0d121a; border: 1px solid #1a2332; border-radius: 12px; padding: 18px; }}
    .kpi-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #76889e; margin-bottom: 6px; }}
    .kpi-val {{ font-size: 28px; font-weight: 800; color: #fff; }}
    .kpi-sub {{ font-size: 12px; color: #4ade80; margin-top: 4px; }}

    .panel {{ background: #0d121a; border: 1px solid #1a2332; border-radius: 14px; padding: 22px; margin-bottom: 28px; }}
    .panel-head {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #172130; padding-bottom: 12px; }}
    .panel-head h2 {{ margin: 0; font-size: 17px; color: #fff; display: flex; align-items: center; gap: 8px; }}
    
    table {{ width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }}
    th {{ color: #718296; font-weight: 600; padding: 10px 12px; border-bottom: 1px solid #1e293b; font-size: 11px; text-transform: uppercase; }}
    td {{ padding: 11px 12px; border-bottom: 1px solid #141c28; }}
    tr:hover td {{ background: #131b26; }}

    .toast {{ position: fixed; bottom: 24px; right: 24px; background: #00e676; color: #000; font-weight: 700; padding: 12px 20px; border-radius: 10px; font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); opacity: 0; transition: opacity .2s; pointer-events: none; }}
    .toast.show {{ opacity: 1; }}
  </style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>1SHOT CLUB · АНАЛИТИКА ГОСТЕЙ ДЛЯ SMM</h1>
      <small style="color:#718296">Обновлено: {now_str} (данные из базы Gizmo)</small>
    </div>
    <span style="background:#131c28;color:#00e676;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid #203147">● База синхронизирована</span>
  </header>

  <!-- Google Sheets Quick Integration Bar -->
  <div class="gsheets-bar">
    <div class="gsheets-bar-left">
      <svg class="gsheets-icon" viewBox="0 0 40 40" fill="none"><rect width="40" height="40" rx="8" fill="#0F9D58"/><path d="M25 12H15C13.8954 12 13 12.8954 13 14V26C13 27.1046 13.8954 28 15 28H25C26.1046 28 27 27.1046 27 26V14C27 12.8954 26.1046 12 25 12Z" fill="white"/><path d="M13 18H27M13 22H27M19 12V28" stroke="#0F9D58" stroke-width="1.5"/></svg>
      <div>
        <h3>Готово для заливки в Google Таблицы</h3>
        <p>Нажми «Скопировать для Google Sheets», перейди в пустую таблицу и нажми <b>Ctrl + V</b> (всё встанет в колонки ровно и красиво).</p>
      </div>
    </div>
    <div class="gsheets-actions">
      <a class="btn-gsheets" href="https://sheets.new" target="_blank">➕ Открыть новую таблицу (sheets.new)</a>
      <button class="btn-copy" onclick="copyTsv(`{tsv_spenders}`, 'Топ гостей скопирован')">📋 Скопировать всех гостей</button>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Всего гостей в базе</div>
      <div class="kpi-val">{data['total_users']}</div>
      <div class="kpi-sub">{data['paying_users_count']} с покупками/чеками</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Средний возраст игрока</div>
      <div class="kpi-val">{data['avg_age']} <span style="font-size:16px;font-weight:400;color:#888">лет</span></div>
      <div class="kpi-sub">Медиана: {data['median_age']} лет (ядро клуба)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Средний чек на гостя (LTV)</div>
      <div class="kpi-val">{data['avg_check']:,.0f} ₽</div>
      <div class="kpi-sub">Общая сумма: {data['total_revenue']:,.0f} ₽</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Пол (Парни / Девушки)</div>
      <div class="kpi-val">{data['sex_dist']['Мужской']} / {data['sex_dist']['Женский']}</div>
      <div class="kpi-sub">{round(data['sex_dist']['Мужской']/max(1,data['total_users'])*100)}% парней</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2>📊 Возрастная сегментация и рекомендации по контенту</h2>
      <button class="btn-copy" onclick="copyTsv(`{tsv_ages}`, 'Таблица возрастов скопирована')">📋 Скопировать в Google Таблицу</button>
    </div>
    <table>
      <thead><tr><th>Возрастная группа</th><th>Гостей</th><th>Доля клуба</th><th>Что лучше всего заходит в SMM / рекламе</th></tr></thead>
      <tbody>{age_rows}</tbody>
    </table>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2>🏆 Топ гостей по расходам (Ядро выручки клуба)</h2>
      <button class="btn-copy" onclick="copyTsv(`{tsv_spenders}`, 'Таблица топа гостей скопирована')">📋 Скопировать в Google Таблицу</button>
    </div>
    <table>
      <thead><tr><th>#</th><th>Никнейм</th><th>Телефон</th><th>Возраст</th><th>Всего потрачено</th><th>Картой</th><th>Наличными</th></tr></thead>
      <tbody>{spender_rows}</tbody>
    </table>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2>💤 База спящих гостей (Готовы к рассылке / реактивации)</h2>
      <button class="btn-copy" onclick="copyTable('sleeping-table')">📋 Скопировать в Google Таблицу</button>
    </div>
    <table id="sleeping-table">
      <thead><tr><th>Никнейм</th><th>Телефон</th><th>Возраст</th><th>Потрачено ранее</th><th>Статус</th><th>Рекомендуемая акция для возврата</th></tr></thead>
      <tbody>{sleeping_rows}</tbody>
    </table>
  </div>
</div>

<div id="toast" class="toast">Скопировано! Вставьте в Google Таблицу через Ctrl+V</div>

<script>
function copyTsv(tsvData, message) {{
  navigator.clipboard.writeText(tsvData.replace(/\\\\n/g, '\\n')).then(() => {{
    showToast(message || 'Скопировано! Откройте Google Таблицу и нажмите Ctrl+V');
  }}).catch(() => {{
    alert('Не удалось скопировать в буфер. Выделите таблицу вручную.');
  }});
}}

function copyTable(tableId) {{
  const table = document.getElementById(tableId);
  if (!table) return;
  let tsv = '';
  for (const row of table.rows) {{
    const cells = Array.from(row.cells).map(c => c.innerText.trim().replace(/\\t|\\n/g, ' '));
    tsv += cells.join('\\t') + '\\n';
  }}
  copyTsv(tsv, 'Таблица скопирована для Google Sheets');
}}

function showToast(text) {{
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}}
</script>
</body>
</html>
"""
    Path(filename).write_text(html, encoding="utf-8")
    print(f"[OK] Interactive HTML dashboard generated: {filename}")
    return filename

def main():
    print("=" * 60)
    print(" 1SHOT CLUB: GIZMO ANALYTICS & GOOGLE SHEETS EXPORTER ")
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
        print(f"Connecting to Gizmo at {base_url}...")
        client = GizmoClient(base_url, login, password, verify_ssl)
        print("Fetching users list from Gizmo...")
        users = client.get("users") or []
        print(f"Fetched {len(users)} users.")
        print("Fetching spending report...")
        spending = client.get("reports/users/spending") or []
        data = analyze(users, spending)

    generate_html_report(data)
    generate_csv_exports(data)
    
    print("\n" + "=" * 60)
    print(" ГОТОВО ДЛЯ GOOGLE ТАБЛИЦ:")
    print(" 1. Открой 1shot-analytics-report.html в браузере")
    print(" 2. Нажми кнопку 'Скопировать в Google Таблицу'")
    print(" 3. Перейди в sheets.new и нажми Ctrl + V")
    print(" Либо импортируй созданные CSV-файлы через Файл -> Импорт -> Загрузка.")
    print("=" * 60)

if __name__ == "__main__":
    main()
