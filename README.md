# 1SHOT — Telegram Mini App для бронирования компьютеров

Мини-апп для гостей компьютерного клуба: видит, какие компы свободны, бронирует
себе на нужное время, получает PIN для входа на машину. Клуб работает на
**Gizmo (GAMP)** — брони реально создаются в Gizmo через его Web API.

```
Telegram Mini App (public/, GitHub Pages)
        │  fetch() по HTTPS + заголовок x-telegram-init-data
        ▼
Supabase Edge Functions (Deno)  ◄── секреты: BOT_TOKEN, креды Gizmo
        │  HTTP Basic Auth (через туннель)
        ▼
Cloudflare Tunnel ──► Gizmo Server (172.20.103.10, внутрисеть клуба)

Supabase Postgres: hosts_cache (кэш статусов), reservations (брони + защита
от гонок через EXCLUDE-констрейнт), users_map (telegram_id → gizmo_user_id)
```

Почему так: креды оператора Gizmo **не хранятся** ни в JS клиента, ни в
браузере — только в secrets Supabase. Гость не может прочитать их из DevTools.
Запрос к бэкенду валидируется подписью `Telegram.WebApp.initData`
(HMAC-SHA256 с токеном бота) — сторонний скрипт без реального Telegram-аккаунта
не пройдёт.

---

## Структура репозитория

```
public/                     фронт мини-аппа (статика, GitHub Pages)
  index.html, style.css, app.js
  config.js                 ⚙️ отредактировать API_BASE перед деплоем
supabase/
  config.toml               verify_jwt=false для всех функций
  migrations/…init.sql      схема БД (hosts_cache, users_map, reservations)
  functions/
    shared/                 общий код: telegram.ts (initData), gizmo.ts (API),
                            db.ts (PostgREST), http.ts, time.ts, env.ts
    hosts/                  GET  /hosts                  статусы компов (кэш 8 с)
    reserve/                POST /reserve                создать бронь
    my-reservations/        GET  /my-reservations         мои активные брони
    cancel-reservation/     POST /cancel-reservation      отменить бронь
tunnel/config.example.yaml  пример конфига cloudflared
tests/                      32 теста: initData, Gizmo-клиент, все функции
```

---

## Развёртывание по шагам

### Шаг 1. Cloudflare Tunnel на компе с Gizmo Server

Доступно из интернета: у вас уже включён веб-портал Gizmo (Swagger на
`https://172.20.103.10/doc/index.html`, т.е. HTTPS на 443).

1. Купите (или используйте свой) домен в Cloudflare, добавьте его в зону.
2. Скачайте `cloudflared` для ОС сервера:
   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   (Windows: `cloudflared.exe` в `C:\bin\cloudflared`).
3. В терминале **на компе с Gizmo**:
   ```bat
   cloudflared tunnel login
   ```
   В браузере подтвердите привязку домена. Затем:
   ```bat
   cloudflared tunnel create 1shot-gizmo
   cloudflared tunnel route dns 1shot-gizmo gizmo.ВАШ-ДОМЕН.ТЛД
   ```
4. Скопируйте `tunnel/config.example.yaml` рядом с cloudflared и заполните:
   - `tunnel:` — id из файла `C:\Users\<user>\.cloudflared\1shot-gizmo.json`;
   - `hostname:` — `gizmo.ВАШ-ДОМЕН.ТЛД`;
   - `service:` — адрес веб-API Gizmo в локалке. У вас веб-портал отдаётся по
     HTTPS на 443 → оставьте `service: https://172.20.103.10:443` и
     `originRequest.noTLSVerify: true` (внутренний сертификат, возможно,
     self-signed). Если есть обычный HTTP-порт (80/8080) — проще
     `service: http://172.20.103.10:8080` без `noTLSVerify`.
5. Запустите и проверьте:
   ```bat
   cloudflared --config config.yaml run
   ```
   ```bat
   curl -k https://gizmo.ВАШ-ДОМЕН.ТЛД/doc/index.html
   ```
   Должен открыться Swagger.
6. Запустите cloudflared как службу, чтобы переживал перезагрузку:
   ```bat
   cloudflared service install
   sc stop cloudflared && sc start cloudflared
   ```
   (конфиг должен лежать там, куда указывает `--config` при `service install`).

> Туннель открывает **весь** веб-API Gizmo по публичному URL. Второй слой
> защиты — шаг 2.

### Шаг 2. Защита туннеля: секретный заголовок

Все запросы бэкенда к Gizmo идут с заголовком `x-1shot-secret: <секрет>`
(секрет задаётся в Supabase, см. шаг 3). На Cloudflare ставим WAF-правило,
режущее всё без него:

1. Cloudflare → ваш домен → **Security → WAF → Custom rules → Create rule**.
2. Expression:
   ```
   (http.host eq "gizmo.ВАШ-ДОМЕН.ТЛД") and
   (not (http.request.headers["x-1shot-secret"] eq "СЛЧАЙНЫЙ_ДЛИННЫЙ_СЕКРЕТ"))
   ```
3. Action: **Block**. Правило должно стоять выше остальных (Execute rule first).

Теперь Swagger и API по публичному URL доступны только тому, кто знает секрет,
а креды оператора — только тому, кто знает их. Двойная защита.

> Альтернатива: Cloudflare Access (Zero Trust, бесплатный тариф) с service
> token — работает, но тяжелее в настройке.

### Шаг 3. Supabase

1. Создайте проект на https://supabase.com.
2. Примените миграцию. Варианты:
   - CLI: `supabase link --project-ref <ref>` → `supabase db push`;
   - или в дашборде: **SQL Editor → New query** → вставьте содержимое
     `supabase/migrations/20260918000000_init.sql` → Run.
3. Секреты функций. CLI:
   ```bash
   supabase secrets set BOT_TOKEN="123456:AAF..." \
     GIZMO_BASE_URL="https://gizmo.ВАШ-ДОМЕН.ТЛД" \
     GIZMO_LOGIN="логин_оператора" \
     GIZMO_PASSWORD="пароль_оператора" \
     GIZMO_TUNNEL_SECRET="тот_же_секрет_что_в_WAF" \
     TIMEZONE_OFFSET_HOURS="3"
   ```
   или дашборд: **Functions → (функция) → Function secrets**.

   | Секрет | Обязательно | Что это |
   |---|---|---|
   | `BOT_TOKEN` | да | токен бота от BotFather (для проверки initData) |
   | `GIZMO_BASE_URL` | да | публичный URL туннеля до Gizmo |
   | `GIZMO_LOGIN` / `GIZMO_PASSWORD` | да | учётки оператора Gizmo (Basic Auth) |
   | `GIZMO_TUNNEL_SECRET` | да | общий секрет для WAF-правила шага 2 |
   | `TIMEZONE_OFFSET_HOURS` | да | часовой пояс клуба: Москва 3, Алматы/Ташкент 5, Астана 5… |
   | `GIZMO_API_BASE` | нет | путь API, по умолчанию `/api/v2.0` (если ваш Swagger v1 — `/api/v1`) |
   | `CACHE_TTL_SEC` | нет | свежесть кэша статусов, по умолчанию 8 |

   `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` подставляются платформой сами.
4. Задеплойте функции:
   ```bash
   supabase functions deploy hosts reserve my-reservations cancel-reservation
   ```
   (`verify_jwt = false` уже стоит в `supabase/config.toml`, но CLI можно
   подстраховать флагом `--no-verify-jwt`.)

### Шаг 4. Проверьте связку

`initData` берётся из любого открытого мини-аппа (DevTools →
`Telegram.WebApp.initData`) или из Telegram Web в браузере.

```bash
INIT_DATA="user=%7B%22id%22%3A...&auth_date=...&hash=..."

# 1. статусы компов (должен вернуться JSON со списком хостов)
curl "https://<ref>.supabase.co/functions/v1/hosts" \
  -H "x-telegram-init-data: $INIT_DATA"

# 2. без/с поддельным initData → 401
curl "https://<ref>.supabase.co/functions/v1/hosts" \
  -H "x-telegram-init-data: user=xx&hash=deadbeef"

# 3. тестовая бронь (id хоста из ответа шага 1)
curl -X POST "https://<ref>.supabase.co/functions/v1/reserve" \
  -H "content-type: application/json" -H "x-telegram-init-data: $INIT_DATA" \
  -d '{"hostId": 1, "durationMinutes": 60}'
```

Откройте Gizmo Manager — броня видна в списке Reservations у пользователя
`tg_<telegram_id>` с PIN. **Обязательно сверьте** в Swagger (`/doc/index.html`
→ Reservations → Try it out) реальные поля запроса/ответа `POST /reservations`
и `GET /hosts` — если в вашей версии Gizmo что-то отличается, правки
ограничены двумя точками: `supabase/functions/shared/gizmo.ts`
(тело `createReservation` и `normalizeHost`).

Проверка, которую я бы сделал с вашими реальными кредами (у меня их нет):
- `GET /api/v2.0/hosts` — какие поля у хоста (Status? IsOnline?);
- `POST /api/v2.0/reservations` с минимальным телом — какой формат `Date`
  принимает, что возвращает (id брони?), требует ли `ProductId`;
- `POST /api/v2.0/users` — создаётся ли пользователь без email;
- `GET /api/v2.0/users?Username=tg_1` — работает ли фильтр.

### Шаг 5. Фронт + BotFather

1. В `public/config.js` впишите:
   - `API_BASE: "https://<ref>.supabase.co/functions/v1"`;
   - `CLUB_NAME`, при желании `DURATIONS_MINUTES`.
2. GitHub Pages: включите в Settings → Pages → **Source: GitHub Actions**
   (воркфлоу `.github/workflows/pages.yml` уже есть и сам деплоит `public/`
   на каждый push в `main`). URL вида `https://<логин>.github.io/1shot/`.
3. BotFather: `/newbot` (или существующий) → **Bot Settings → Menu Button →
   Configure Menu Button** (или `/newapp`) → вставьте URL страницы.
   Тоже в BotFather: **/setuserpic**, **/setabouttext** — косметика.
4. Откройте бота → кнопка меню → мини-апп. Бронь видна и в Gizmo Manager.

> Имейте в виду: `https://` обязателен, и GitHub Pages уже с HTTPS.
> Мини-апп в Telegram Desktop/Android/iOS подтянет стили из
> `telegram-web-app.js` — тема тёмная, под клуб.

---

## API бэкенда (для справки)

Все эндпоинты требуют заголовок `x-telegram-init-data: <initData>`.

| Метод | Путь | Тело | Ответ 200 | Ошибки |
|---|---|---|---|---|
| GET | `/functions/v1/hosts` | — | `{hosts:[{id,name,number,groupId,status,isFree,isOutOfOrder,isLocked}], source, updatedAt[, warning]}` | 401, 502 |
| POST | `/functions/v1/reserve` | `{hostId:number, durationMinutes:int 5..1440}` | `{id, hostId, hostName, startsAt, endsAt, pin}` | 400, 401, 404, 409 (занят/гонка/уже бронь), 502 |
| GET | `/functions/v1/my-reservations` | — | `{reservations:[{id,hostId,hostName,pin,startsAt,endsAt}]}` | 401 |
| POST | `/functions/v1/cancel-reservation` | `{id:number}` | `{ok:true, id}` | 400, 401, 404 |

`source` в `/hosts`: `gizmo` (только что опросили), `cache` (кэш < 8 с),
`stale-cache` (Gizmo недоступен, отдаём последний кэш + `warning`).

## Как устроена бронь

1. Гость тапает свободный комп → шторка с длительностью (30/60/120/240 мин).
2. Бэкенд: проверяет initData → смотрит хост в кэше → **фиксирует слот в
   Postgres** (`EXCLUDE USING gist (host_id WITH =, tstzrange(starts_at,
   ends_at) WITH &&) WHERE status='active'`). Два гостя, забронировавших
   одновременно, не пересекутся: проигравший получает 23P01 → «409: не успели».
3. Находит/создаёт пользователя Gizmo `tg_<telegram_id>` (маппинг в
   `users_map`), генерирует 4-значный PIN и шлёт
   `POST /api/v2.0/reservations {UserId, Date, Duration, Pin, Hosts:[{HostId}], Note}`.
4. Гость видит PIN в «Мои брони» и вводит его на экране компе (Gizmo:
   Login Pin — вход по PIN на забронированный хост).
5. Если Gizmo отказал — слот в БД помечается `failed` и перестаёт блокировать
   время, гостю 409/502.

## Безопасность

- Креды Gizmo и токен бота — только в secrets Supabase; в клиенте их нет.
- Каждый запрос валидируется HMAC-подписью initData (реализация проверена
  тестами против эталона node:crypto). `auth_date` старше 24 ч (для мутаций —
  1 ч) отклоняется.
- Туннель до Gizmo закрыт WAF-правилом по секретному заголовку.
- RLS на всех таблицах включён, политик нет: прямой доступ к PostgREST с
  anon-ключом ничего не прочитает; пишут/читают только edge-функции
  (service role).
- Ограничение: initData нельзя подделать без валидного Telegram-аккаунта, но
  rate-limit на Supabase free-планах — общий; при массовом спахе стоит
  докрутить (например, лимит броней на пользователя в `reserve`).

## Оплата

Пока **без предоплаты**: бронь фиксирует место, оплата на кассе при входе
(оператор в Gizmo делает вход с баланса/налички как обычно).

Вариант с предоплатой (следующий шаг):
- Telegram Payments (бот → `sendInvoice`) на стороне бэкенда: успешная оплата
  создаёт бронь, а через `DepositTransactions` Gizmo API начисляет гостю
  депозит — при входе списывается автоматически;
- либо ЮKassa: платёж → webhook → та же логика.
  Оба варианта добавляются новой edge-функцией, существующие не трогаются.

## Ограничения v1 (осознанные)

- Если гость забронировал и не пришёл — слот в БД «держит» время до конца
  брони (в Gizmo машина при этом свободна). Оператор видит всё в Manager и
  может отменить вручную; позже можно добавить авто-списание no-show.
- Статусы — кэш ≤ 8 с (настраивается `CACHE_TTL_SEC`). Realtime через
  Supabase Realtime — кандидат на v2.
- `POST /reservations` в разных версиях Gizmo может принимать ещё и
  `ProductId`/`BillingProfileId` — если ваш Swagger требует, добавьте поле в
  `createReservation` (одна строка) или через секрет.

## Локальная разработка и тесты

```bash
npm install        # devDeps: typescript, @types/node
npm test           # 32 теста (Node 22+, нативный TS): initData, gizmo, handlers
npm run typecheck  # tsc --noEmit
```

Тесты поднимают edge-функции в Node через шим Deno и моки PostgREST/Gizmo —
смена логики в `supabase/functions/` проверяется без живых сервисов.

Локальный Supabase (полный цикл с БД): `supabase start` →
`supabase db reset` (применит миграцию) → `supabase functions serve hosts`
и т.п. — для отладки с реальным Postgres.
