/* ============================================================
   ⚙️  НАСТРОЙКИ МИНИ-АППА — отредактируйте перед деплоем
   ============================================================ */

window.APP_CONFIG = {
  // Базовый URL бэкенда (Supabase Edge Functions).
  // Формат: https://<project-ref>.supabase.co/functions/v1
  // project-ref — в URL вашего проекта Supabase.
  API_BASE: "https://YOUR_PROJECT_REF.supabase.co/functions/v1",

  // Название клуба в шапке.
  CLUB_NAME: "1SHOT",

  // Как часто опрашиваем статусы (мс). 10000 = раз в 10 секунд.
  POLL_INTERVAL_MS: 10000,

  // Варианты длительности брони (минуты).
  DURATIONS_MINUTES: [30, 60, 120, 240],
};
