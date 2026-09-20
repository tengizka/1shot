/**
 * Чтение переменных окружения (secrets Supabase Edge Functions).
 * В продакшене переменные задаются: supabase secrets set / дашборд Functions.
 */

export function envStr(name: string, fallback?: string): string {
  const v = Deno.env.get(name);
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export function envInt(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${v}`);
  }
  return n;
}
