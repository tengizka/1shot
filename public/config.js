/* ============================================================
   ⚙️  НАСТРОЙКИ МИНИ-АППА — отредактируйте перед деплоем
   ============================================================ */

window.APP_CONFIG = {
  // Базовый URL бэкенда (Supabase Edge Functions).
  // Формат: https://<project-ref>.supabase.co/functions/v1
  API_BASE: "https://YOUR_PROJECT_REF.supabase.co/functions/v1",

  // Название клуба в шапке.
  CLUB_NAME: "1SHOT",

  // Адрес клуба (под шапкой / в футере).
  CLUB_ADDRESS: "Киберхаус / 1SHOT",

  // Как часто опрашиваем статусы (мс). 10000 = раз в 10 секунд.
  POLL_INTERVAL_MS: 10000,

  // Варианты длительности брони (минуты).
  DURATIONS_MINUTES: [30, 60, 120, 240],

  /* --------------------------- Зоны клуба ---------------------------
     Машина попадает в зону по:
       1) groupIds — если её HostGroupId из Gizmo есть в списке
          (самый надёжный способ: впишите id групп из Gizmo Manager);
       2) numbers / ranges — по номеру машины (Number в Gizmo).
     ZONE с fallback: true ловит всех остальных.
     accent: purple | pink | blue | red — неоновый цвет зоны.
  ------------------------------------------------------------------- */
  ZONES: [
    { key: "ps5",  title: "PS5",           subtitle: "PlayStation 5", accent: "blue",   numbers: [1] },
    { key: "vip",  title: "VIP-зал",       subtitle: "vip",  accent: "pink",   ranges: [[11, 15], [21, 25]] },
    { key: "main", title: "Основной зал",  subtitle: "standard",     accent: "purple", fallback: true },
  ],
};
