#!/usr/bin/env python3
"""
1SHOT Club Analytics & SMM Intelligence Tool
Pulls guests, spending, sessions and demographics from Gizmo API and generates:
1. Interactive visual HTML Dashboard (1shot-analytics-report.html)
2. CSV tables ready for Excel / Google Sheets
"""
import os, sys, json, base64, urllib.request, urllib.error, ssl
from datetime import datetime, timezone
from pathlib import Path

def find_env():
    # Check default Windows LocalAppData or current directory
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
        # formats like '2004-05-12T00:00:00' or '2004-05-12'
        dt = datetime.fromisoformat(birth_date_str.replace("Z", "+00:00").split("T")[0])
        today = datetime.now()
        age = today.year - dt.year - ((today.month, today.day) < (dt.month, dt.day))
        return age if 5 <= age <= 100 else None
    except Exception:
        return None

def analyze(users, spending_list):
    total_users = len(users)
    ages = []
    age_groups = {"До 18 (подростки)": 0, "18–21 (студенты/молодёжь)": 0, "22–25": 0, "26–30": 0, "31+ (старшая аудитория)": 0}
    sex_dist = {"Мужской": 0, "Женский": 0, "Не указан": 0}
    
    for u in users:
        # Age
        age = calculate_age(u.get("birthDate"))
        if age is not None:
            ages.append(age)
            if age < 18: age_groups["До 18 (подростки)"] += 1
            elif age <= 21: age_groups["18–21 (студенты/молодёжь)"] += 1
            elif age <= 25: age_groups["22–25"] += 1
            elif age <= 30: age_groups["26–30"] += 1
            else: age_groups["31+ (старшая аудитория)"] += 1
        
        # Sex: 1=Male, 2=Female, 0=None
        s = u.get("sex")
        if s == 1: sex_dist["Мужской"] += 1
        elif s == 2: sex_dist["Женский"] += 1
        else: sex_dist["Не указан"] += 1

    avg_age = round(sum(ages) / len(ages), 1) if ages else 0
    median_age = sorted(ages)[len(ages) // 2] if ages else 0

    # Spending & checks
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
            spenders.append({
                "id": uid,
                "username": s.get("username") or u.get("userName") or f"Гость #{uid}",
                "name": f"{u.get('firstName','') or ''} {u.get('lastName','') or ''}".strip() or "—",
                "phone": u.get("mobilePhone") or u.get("phone") or "—",
                "total": tot,
                "cash": cash,
                "card": card,
                "deposit": dep,
                "age": calculate_age(u.get("birthDate")) or "—"
            })

    spenders.sort(key=lambda x: x["total"], reverse=True)
    avg_check = round(total_revenue / paying_users_count, 1) if paying_users_count else 0

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
        "top_spenders": spenders[:50]
    }

def generate_html_report(data, filename="1shot-analytics-report.html"):
    now_str = datetime.now().strftime("%d.%m.%Y в %H:%M")
    
    age_rows = "".join(f"<tr><td><b>{k}</b></td><td>{v}</td><td>{round(v/max(1,data['users_with_age'])*100, 1)}%</td></tr>" for k, v in data["age_groups"].items())
    
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
    """ for i, s in enumerate(data["top_spenders"][:30]))

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>1SHOT CLUB — Сводная SMM & Маркетинг Аналитика</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {{ background: #080a0f; color: #e6eaf0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; }}
    .container {{ max-width: 1200px; margin: 0 auto; }}
    header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1f2733; padding-bottom: 20px; margin-bottom: 28px; }}
    h1 {{ margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #fff; }}
    .badge {{ background: #1a2230; color: #00e676; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; border: 1px solid #29384d; }}
    
    .kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 32px; }}
    .kpi-card {{ background: #0f141c; border: 1px solid #1a2332; border-radius: 14px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }}
    .kpi-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #8292a6; margin-bottom: 8px; }}
    .kpi-val {{ font-size: 32px; font-weight: 800; color: #fff; }}
    .kpi-sub {{ font-size: 12px; color: #4ade80; margin-top: 6px; }}

    .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }}
    @media(max-width: 800px) {{ .grid-2 {{ grid-template-columns: 1fr; }} }}
    
    .panel {{ background: #0f141c; border: 1px solid #1a2332; border-radius: 14px; padding: 24px; }}
    .panel h2 {{ margin-top: 0; font-size: 18px; margin-bottom: 18px; color: #fff; display: flex; align-items: center; gap: 8px; }}
    
    table {{ width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }}
    th {{ color: #718296; font-weight: 600; padding: 10px 12px; border-bottom: 1px solid #1e293b; font-size: 11px; text-transform: uppercase; }}
    td {{ padding: 12px; border-bottom: 1px solid #141c28; }}
    tr:hover td {{ background: #141b26; }}
    
    .smm-tips {{ background: #111a26; border-left: 4px solid #3b82f6; border-radius: 0 12px 12px 0; padding: 18px; margin-top: 24px; font-size: 13px; line-height: 1.7; }}
    .smm-tips h3 {{ margin: 0 0 8px; color: #60a5fa; font-size: 15px; }}
  </style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>1SHOT CLUB · АНАЛИТИКА ГОСТЕЙ</h1>
      <small style="color:#718296">Сформировано: {now_str} (данные из базы Gizmo)</small>
    </div>
    <span class="badge">● База актуальна</span>
  </header>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Всего гостей в базе</div>
      <div class="kpi-val">{data['total_users']}</div>
      <div class="kpi-sub">{data['paying_users_count']} с покупками/чеками</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Средний возраст игрока</div>
      <div class="kpi-val">{data['avg_age']} <span style="font-size:18px;font-weight:400;color:#888">лет</span></div>
      <div class="kpi-sub">Медиана: {data['median_age']} лет (ядро клуба)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Средний чек на гостя (LTV)</div>
      <div class="kpi-val">{data['avg_check']:,.0f} ₽</div>
      <div class="kpi-sub">Суммарная выручка: {data['total_revenue']:,.0f} ₽</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Соотношение М / Ж</div>
      <div class="kpi-val">{data['sex_dist']['Мужской']} / {data['sex_dist']['Женский']}</div>
      <div class="kpi-sub">{round(data['sex_dist']['Мужской']/max(1,data['total_users'])*100)}% парней</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <h2>📊 Демография и возрастные группы</h2>
      <table>
        <thead><tr><th>Группа аудитории</th><th>Гостей</th><th>Доля</th></tr></thead>
        <tbody>{age_rows}</tbody>
      </table>
      <div class="smm-tips">
        <h3>💡 Вывод для SMM и рекламы:</h3>
        Твоё ключевое ядро аудитории — <b>{data['avg_age']} лет</b>. Таргетинг VK и Telegram Ads лучше всего настраивать на диапазон <b>17–24 года</b> с акцентом на ночные пакеты, шутеры (CS2, Valorant) и турнирные форматы.
      </div>
    </div>

    <div class="panel">
      <h2>🏆 Топ гостей по расходам (Ядро выручки)</h2>
      <table>
        <thead><tr><th>#</th><th>Никнейм</th><th>Телефон</th><th>Возраст</th><th>Всего</th><th>Карта</th><th>Наличные</th></tr></thead>
        <tbody>{spender_rows}</tbody>
      </table>
    </div>
  </div>
</div>
</body>
</html>
"""
    Path(filename).write_text(html, encoding="utf-8")
    print(f"\n[OK] Interactive HTML dashboard generated: {filename}")
    return filename

def export_csv(data):
    p = Path("1shot-guests-spending.csv")
    with p.open("w", encoding="utf-8-sig") as f:
        f.write("Номер;Никнейм;Имя;Телефон;Возраст;Сумма покупок;Карта;Наличные;Депозит\n")
        for i, s in enumerate(data["top_spenders"]):
            f.write(f"{i+1};{s['username']};{s['name']};{s['phone']};{s['age']};{s['total']};{s['card']};{s['cash']};{s['deposit']}\n")
    print(f"[OK] Excel CSV table exported: {p}")

def main():
    print("=" * 60)
    print(" 1SHOT CLUB: GIZMO ANALYTICS & DEMOGRAPHICS COLLECTOR ")
    print("=" * 60)

    env_path = find_env()
    env = load_env(env_path) if env_path else {}
    
    base_url = env.get("GIZMO_BASE_URL") or os.environ.get("GIZMO_BASE_URL")
    login = env.get("GIZMO_LOGIN") or os.environ.get("GIZMO_LOGIN")
    password = env.get("GIZMO_PASSWORD") or os.environ.get("GIZMO_PASSWORD")
    verify_ssl = (env.get("GIZMO_VERIFY_SSL", "false").lower() == "true")

    if not base_url or not login or not password:
        print("\nNote: Live Gizmo credentials not found in environment.")
        print("Generating a demonstration report with realistic club distribution...")
        # Synthetic sample distribution to preview the exact tables and report
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
                sample_spending.append({"userId": u["id"], "username": u["userName"], "total": tot, "cash": cash, "creditCard": card})
        
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

    html_file = generate_html_report(data)
    export_csv(data)
    
    # Try opening in browser
    try:
        import webbrowser
        webbrowser.open(f"file://{Path(html_file).resolve()}")
    except Exception:
        pass

    print("\n" + "=" * 60)
    print(" SUMMARY PREVIEW:")
    print(f"  • Всего гостей в базе: {data['total_users']}")
    print(f"  • Средний возраст: {data['avg_age']} лет (медиана {data['median_age']} лет)")
    print(f"  • Средний чек (LTV): {data['avg_check']:,.0f} ₽")
    print(f"  • Выручка по базе: {data['total_revenue']:,.0f} ₽")
    print(f"  • Возрастные группы: {json.dumps(data['age_groups'], ensure_ascii=False, indent=4)}")
    print("=" * 60)

if __name__ == "__main__":
    main()
