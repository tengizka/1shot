/**
 * POST /functions/v1/cancel-reservation
 *
 * Тело: { "id": 42 }  — id брони из /my-reservations.
 *
 * Гость может отменить только СВОЮ активную бронь.
 * Параллельно бронь снимается в Gizmo (если там ещё есть).
 */

import { HttpError, ok, serve } from "../shared/http.ts";
import { requireTelegramUser } from "../shared/telegram.ts";
import { db } from "../shared/db.ts";
import { deleteReservation } from "../shared/gizmo.ts";

serve(async (req: Request) => {
  if (req.method !== "POST") throw new HttpError(405, "Метод не поддерживается.");
  const td = await requireTelegramUser(req, 3600);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Некорректное тело запроса (ожидается JSON).");
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "id: укажите id брони (число).");
  }

  const d = db();
  const rows = await d.select("reservations", {
    params: {
      id: `eq.${id}`,
      telegram_id: `eq.${td.user.id}`,
      status: "eq.active",
    },
  });
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, "Бронь не найдена (возможно, уже отменена или завершена).");
  }

  const gizmoId = row.gizmo_reservation_id;
  if (typeof gizmoId === "number") {
    try {
      await deleteReservation(gizmoId);
    } catch (e) {
      // Не критично: бронь в Gizmo всё равно завершится по времени,
      // а оператор видит её в своём интерфейсе.
      console.error(`cancel: failed to delete gizmo reservation ${gizmoId}:`, e);
    }
  }

  await d.update(
    "reservations",
    { status: "cancelled", cancelled_at: new Date().toISOString() },
    { id: `eq.${id}` },
  );

  return ok({ ok: true, id });
});
