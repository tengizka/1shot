// Agent-only profile writer. reservations now references profiles.telegram_id.
import { createClient } from 'npm:@supabase/supabase-js@2.7.1';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agent-secret',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('AGENT_SECRET');
  if (!secret || req.headers.get('x-agent-secret') !== secret) return json({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Profile service not configured' }, 500);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body || !Number.isSafeInteger(body.telegram_id) || body.telegram_id <= 0 ||
      !Number.isSafeInteger(body.gizmo_user_id) || body.gizmo_user_id <= 0 ||
      typeof body.username !== 'string' || !body.username.trim()) {
    return json({ error: 'Valid telegram_id, gizmo_user_id and username required' }, 400);
  }
  const row: Record<string, unknown> = {
    telegram_id: body.telegram_id, gizmo_user_id: body.gizmo_user_id,
    username: body.username, updated_at: new Date().toISOString(),
  };
  for (const field of ['first_name', 'last_name']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') return json({ error: `Invalid ${field}` }, 400);
    if (body[field]) row[field] = body[field];
  }
  const { error } = await createClient(url, key).from('profiles').upsert(row, { onConflict: 'telegram_id' });
  if (error) {
    console.error('Profile write failed:', error.code);
    return json({ error: 'profile_save_failed' }, 500);
  }
  return json({ ok: true });
});
