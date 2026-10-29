import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-secret",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const AGENT_SECRET = Deno.env.get("AGENT_SECRET")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const secretFromHeader = req.headers.get("x-agent-secret");
  const secretFromBody = body?.secret;
  if (secretFromHeader !== AGENT_SECRET && secretFromBody !== AGENT_SECRET) {
    return json({ error: "forbidden" }, 403);
  }

  const hosts = body.hosts;
  if (!Array.isArray(hosts)) return json({ error: "hosts_must_be_array" }, 400);

  const rows = hosts.map((h: any) => ({
    host_id: String(h.host_id),
    zone: String(h.zone),
    status: String(h.status),
    gizmo_host_id: h.gizmo_host_id ? String(h.gizmo_host_id) : null,
    // Desk's estimate of when a busy PC frees up (the player's remaining time).
    free_at: h.status === "busy" && h.free_at && !isNaN(Date.parse(h.free_at)) ? new Date(h.free_at).toISOString() : null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("hosts_cache").upsert(rows, { onConflict: "host_id" });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, count: rows.length });
});
