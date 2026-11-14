-- The queue for a busy PC is switched off: a busy PC is simply «занят». Old app versions get a refusal.
select cron.unschedule('club-queue-tick');
delete from club_queue;
create or replace function public.club_queue_join(p_user bigint, p_host text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
begin
 raise exception 'Очереди больше нет: выбери свободный ПК';
end $function$;
