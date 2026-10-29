#!/usr/bin/env bash
# Moves 1SHOT to a fresh Supabase project: schema, data, edge functions, secrets, mini-app URL.
# Usage: scripts/restore-supabase.sh <new-project-ref> <database-url> <path-to-data.sql>
#   new-project-ref  — the id from https://<ref>.supabase.co
#   database-url     — Project Settings → Database → Connection string (URI), with the password
#   data.sql         — the private backup file (never commit it)
# Needs: psql, the supabase CLI (logged in: `supabase login`). Asks for TELEGRAM_BOT_TOKEN and AGENT_SECRET.
set -euo pipefail
REF=${1:?project ref}; DB=${2:?database url}; DATA=${3:?data.sql}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

echo '1/5 Schema'
psql "$DB" -v ON_ERROR_STOP=1 -q -c 'create schema if not exists extensions;' -f "$ROOT/supabase/backup/schema.sql"

echo '2/5 Data'
psql "$DB" -v ON_ERROR_STOP=1 -q -f "$DATA"

echo '3/5 Secrets'
read -rsp 'TELEGRAM_BOT_TOKEN: ' BOT; echo
read -rsp 'AGENT_SECRET (the same as in Desk .env): ' AGENT; echo
supabase secrets set --project-ref "$REF" TELEGRAM_BOT_TOKEN="$BOT" AGENT_SECRET="$AGENT" >/dev/null

echo '4/5 Edge functions'
cd "$ROOT"
for f in supabase/functions/*/; do
  name=$(basename "$f"); [ "$name" = _shared ] && continue
  supabase functions deploy "$name" --project-ref "$REF" --no-verify-jwt
done

echo '5/5 Mini-app address'
sed -i.bak "s#https://[a-z0-9]*\.supabase\.co/functions/v1#https://$REF.supabase.co/functions/v1#" miniapp/backend-config.js && rm miniapp/backend-config.js.bak

cat <<EOF

Готово. Осталось руками:
  1. Закоммитить и запушить miniapp/backend-config.js (мини-апп переключится через минуту).
  2. В Desk (.env): SUPABASE_URL=https://$REF.supabase.co и перезапустить Desk.
  3. Открыть https://$REF.supabase.co/functions/v1/club-bot?setup=1 (бот переедет сам).
EOF
