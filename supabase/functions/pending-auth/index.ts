// Supabase Edge Function: pending-auth
// Два режима:
//   GET  ?secret=...  → агент забирает список pending запросов
//   PATCH body: { id, status, gizmo_user_id?, error_message? }
//             → агент отчитывается о результате (и очищает пароль)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_SECRET        = Deno.env.get("AGENT_SECRET")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-agent-secret",
      },
    });
  }

  // Только агент
  const secret = req.headers.get("x-agent-secret") ||
                 new URL(req.url).searchParams.get("secret");
  if (secret !== AGENT_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── GET: отдаём pending запросы ─────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await supa
      .from("auth_requests")
      .select("id, telegram_id, action, username, password, first_name, last_name")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) {
      console.error("Ошибка чтения auth_requests:", error);
      return json({ error: "DB error" }, 500);
    }

    return json({ requests: data ?? [] });
  }

  // ── PATCH: обновляем статус, очищаем пароль ─────────────────
  if (req.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { id, status, gizmo_user_id, error_message } = body as {
      id:             string;
      status:         string;
      gizmo_user_id?: number;
      error_message?: string;
    };

    if (!id || !status) {
      return json({ error: "id and status are required" }, 400);
    }

    const update: Record<string, unknown> = {
      status,
      password:     "",           // очищаем пароль сразу после обработки
      processed_at: new Date().toISOString(),
    };
    if (gizmo_user_id != null) update.gizmo_user_id = gizmo_user_id;
    if (error_message)          update.error_message = error_message;

    const { error } = await supa
      .from("auth_requests")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("Ошибка обновления auth_requests:", error);
      return json({ error: "DB error" }, 500);
    }

    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
