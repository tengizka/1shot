/**
 * GET /functions/v1/my-reservations
 *
 * Активные (ещё не завершённые) брони текущего гостя Telegram.
 */

import { ok, serve } from "../shared/http.ts";
import { requireTelegramUser } from "../shared/telegram.ts";
import { db } from "../shared/db.ts";

serve(async (req: Request) => {
  const td = await requireTelegramUser(req);
  const rows = await db().select("reservations", {
    params: {
      telegram_id: `eq.${td.user.id}`,
      status: "eq.active",
      ends_at: `gt.${new Date().toISOString()}`,
    },
    order: "starts_at.asc",
  });

  return ok({
    reservations: rows.map((r) => ({
      id: r.id,
      hostId: r.host_id,
      hostName: r.host_name,
      pin: r.pin ?? null,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
    })),
  });
});
