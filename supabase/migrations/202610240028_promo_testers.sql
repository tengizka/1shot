-- Staff test accounts: a Telegram on this list may use promo codes again and send more than three applications a day.
-- Guests keep both limits. Remove a tester with: delete from club_promo_testers where telegram_id=…;
create table if not exists public.club_promo_testers(telegram_id bigint primary key,note text,created_at timestamptz not null default now());
alter table public.club_promo_testers enable row level security;
revoke all on public.club_promo_testers from public,anon,authenticated;
grant all on public.club_promo_testers to service_role;
insert into public.club_promo_testers(telegram_id,note) values(6058630016,'Тенгиз, тесты промокодов') on conflict do nothing;
create or replace function public.club_registration_submit(p_id uuid,p_user bigint,p_data jsonb,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
declare existing uuid; promo text; linked jsonb; tester boolean;
begin
 perform pg_advisory_xact_lock(p_user);
 perform club_registration_cleanup();
 tester:=exists(select 1 from club_promo_testers where telegram_id=p_user);
 select id into existing from club_registration_requests where telegram_id=p_user and status in ('awaiting_admin','processing','attention');
 if found then return existing; end if;
 if not tester and (select count(*) from club_registration_requests where telegram_id=p_user and created_at>now()-interval '1 day')>=3 then raise exception 'Не больше трёх анкет в сутки'; end if;
 if p_user<=0 or p_cipher is null or length(p_cipher)>12000 or jsonb_typeof(p_data)<>'object' then raise exception 'invalid_application'; end if;
 promo:=nullif(upper(trim(coalesce(p_data->>'promo_code',''))),'');
 if promo is not null and not exists(select 1 from club_promo_codes where code=promo and active) then raise exception 'Промокод не найден. Проверьте его или продолжите без промокода'; end if;
 if promo is not null and not tester and exists(select 1 from club_promo_redemptions where telegram_id=p_user and (status='done' or reward='granted')) then raise exception 'С этого Telegram бесплатный час уже получали. Продолжите без промокода'; end if;
 select jsonb_build_object('username',username,'gizmo_user_id',gizmo_user_id) into linked from profiles where telegram_id=p_user and gizmo_user_id>0;
 -- Never accept extra fields such as a plaintext password into public summaries.
 insert into club_registration_requests(id,telegram_id,public_data,cipher) values(p_id,p_user,jsonb_strip_nulls(jsonb_build_object('username',p_data->>'username','first_name',p_data->>'first_name','last_name',p_data->>'last_name','mobile_phone',p_data->>'mobile_phone','birth_date',p_data->>'birth_date','sex',p_data->'sex','promo_code',promo,'linked_account',linked)),p_cipher);
 if promo is not null then insert into club_promo_redemptions(registration_id,telegram_id,code) values(p_id,p_user,promo); end if;
 return p_id;
end $$;
notify pgrst,'reload schema';
