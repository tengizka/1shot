-- Shift reports in the owner's DM: 09:00 MSK (night shift 21→9) and 21:00 MSK (day shift 9→21). pg_cron runs in UTC.
-- The bot sends each shift once (club_desk_reports «shift_report_sent» keeps the last key). Applied on 14.11.
select cron.schedule('club-shift-report','0 6,18 * * *',$$select net.http_get('https://zqhfvtgktbfnxcclqqny.supabase.co/functions/v1/club-bot?shift=1')$$);
