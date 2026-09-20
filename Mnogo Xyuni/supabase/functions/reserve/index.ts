/**
 * POST /functions/v1/reserve
 *
 * Тело: { "hostId": 12, "durationMinutes": 60 }
 *
 * Сценарий:
 *   1. Проверяем initData Telegram (max age 1 ч) → получаем telegram_id.
 *   2. Проверяем хост (кэш; если в кэше нет — напрямую из Gizmo).
 *   3. Если у гостя уже есть активная бронь на этот хост — 409.
 *   4. Фиксируем слот в Postgres. EXCLUDE-констрейнт не даст двум
 *      гостям занять одно время: проигравший получает 23P01 → 409.
 *   5. Находим/создаём пользователя в Gizmo (login = tg_<telegram_id>,
 *      маппинг в users_map) и создаём бронь в Gizmo с 4-значным PIN.
 *   6. Если Gizmo отказал — слот помечаем failed (освобождается) и 502/409.
 *
 * Ответ: { id, hostId, hostName, startsAt, endsAt, pin }
 * PIN гость вводит на экране компе при входе.
 */

import { HttpError, ok, serve } from "../shared/http.ts";
import { requireTelegramUser } from "../shared/telegram.ts";
import { db, DbError } from "../shared/db.ts";
import {
  createReservation,
  createUser,
  findUserByUsername,
  GizmoError,
  getHost,
  hostIsFree,
} from "../shared/gizmo.ts";
import { clubTimeIso } from "../shared/time.ts";

function randomPin(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(1000 + (a[0] % 9000));
}

function randomPassword(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Некорректное тело запроса (ожидается JSON).");
  }
  return body;
}

serve(async (req: Request) => {
  if (req.method !== "POST") throw new HttpError(405, "Метод не поддерживается.");
  const td = await requireTelegramUser(req, 3600);
  const user = td.user;

  const body = await parseBody(req);
  const hostId = Number(body.hostId);
  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    throw new HttpError(400, "hostId: укажите id компьютера (число).");
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
    throw new HttpError(400, "durationMinutes: длительность — целое число минут от 5 до 1440.");
  }

  const d = db();
  const nowIso = new Date().toISOString();

  /* 1. Хост: из кэша, при отсутствии — напрямую из Gizmo */
  let hostRow = (await d.select("hosts_cache", { params: { "gizmo_host_id": `eq.${hostId}` } }))[0];
  if (!hostRow) {
    let h = null;
    try {
      h = await getHost(hostId);
    } catch {
      h = null;
    }
    if (!h) throw new HttpError(404, "Компьютер не найден.");
    hostRow = {
      gizmo_host_id: h.id,
      name: h.name,
      number: h.number,
      group_id: h.groupId,
      status: h.status ?? 0,
      is_free: hostIsFree(h),
      is_out_of_order: h.isOutOfOrder,
      is_locked: h.isLocked,
      meta: h.raw,
      updated_at: nowIso,
    };
    await d.upsert("hosts_cache", hostRow, "gizmo_host_id");
  }

  /* 2. Не даём бронировать хост, на который у гостя уже есть активная бронь */
  const mine = await d.select("reservations", {
    params: {
      telegram_id: `eq.${user.id}`,
      host_id: `eq.${hostId}`,
      status: "eq.active",
      ends_at: `gt.${nowIso}`,
    },
  });
  if (mine.length) {
    throw new HttpError(409, "У вас уже есть активная бронь на этот компьютер.");
  }

  if (hostRow.is_out_of_order) throw new HttpError(409, "Этот компьютер в ремонте.");
  if (hostRow.is_locked) throw new HttpError(409, "Этот компьютер сейчас недоступен.");
  if (!hostRow.is_free) {
    throw new HttpError(409, "Этот компьютер сейчас занят или забронирован. Выберите другой.");
  }

  /* 3. Фиксируем слот в БД (защита от гонки двух гостей) */
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const pin = randomPin();
  let localId: number;
  try {
    const inserted = await d.insert("reservations", {
      telegram_id: user.id,
      host_id: hostId,
      host_name: hostRow.name as string,
      pin,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "active",
    });
    const id = inserted[0]?.id;
    if (typeof id !== "number") throw new Error("Postgres не вернул id брони");
    localId = id;
  } catch (e) {
    if (e instanceof DbError && e.code === "23P01") {
      throw new HttpError(409, "Не успели: это время на компьютере только что заняли. Выберите другой.");
    }
    throw e;
  }

  /* 4. Пользователь в Gizmo (создаём один раз, маппинг держим в users_map) */
  let gizmoUserId: number | null = null;
  const mapped = (await d.select("users_map", { params: { "telegram_id": `eq.${user.id}` } }))[0];
  if (mapped && typeof mapped.gizmo_user_id === "number") {
    gizmoUserId = mapped.gizmo_user_id;
  } else {
    const login = `tg_${user.id}`;
    let existing: { id: number; username: string } | null = null;
    try {
      existing = await findUserByUsername(login);
    } catch {
      existing = null;
    }
    if (existing) {
      gizmoUserId = existing.id;
    } else {
      gizmoUserId = await createUser({
        username: login,
        firstName: user.first_name,
        password: randomPassword(),
      });
    }
    await d.upsert(
      "users_map",
      {
        telegram_id: user.id,
        username: user.username ?? "",
        first_name: user.first_name ?? "",
        gizmo_user_id: gizmoUserId,
        gizmo_username: login,
        updated_at: nowIso,
      },
      "telegram_id",
    );
  }

  /* 5. Бронь в Gizmo */
  let gizmoReservationId: number | null = null;
  try {
    gizmoReservationId = await createReservation({
      UserId: gizmoUserId,
      Date: clubTimeIso(startsAt),
      Duration: durationMinutes,
      Pin: pin,
      Hosts: [{ HostId: hostId }],
      Note: "Telegram mini-app",
    });
  } catch (e) {
    // Gizmo отказал — освобождаем слот (status failed не блокирует диапазон)
    await d
      .update("reservations", { status: "failed" }, { id: `eq.${localId}` })
      .catch(() => {});
    if (e instanceof GizmoError && (e.status === 400 || e.status === 409)) {
      throw new HttpError(409, "Gizmo не принял бронь (компьютер мог только что занять). Попробуйте другой.");
    }
    console.error("reserve: gizmo createReservation failed:", e);
    throw new HttpError(502, "Gizmo сейчас недоступен, слот освобождён. Попробуйте ещё раз.");
  }

  await d.update(
    "reservations",
    {
      gizmo_user_id: gizmoUserId,
      gizmo_reservation_id: gizmoReservationId,
    },
    { id: `eq.${localId}` },
  );

  return ok({
    id: localId,
    hostId,
    hostName: hostRow.name,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    pin,
  });
});
