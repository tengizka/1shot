-- Personal data minimisation while the backend runs outside Russia.
-- 1) New accounts are created only at the reception (Desk → Gizmo in the club); online applications are refused.
-- 2) Profiles keep telegram_id ↔ gizmo_user_id and the nickname only: no first/last names.
-- 3) Cached Gizmo account data loses name, email, phone and birth date on every write.
-- Existing copies of those fields are erased. The one application still awaiting the admin is left to finish.
begin;
create or replace function public.club_strip_account_pd() returns trigger language plpgsql set search_path=public as $$
begin
 if new.data is not null and jsonb_typeof(new.data)='object' then
  new.data:=new.data-'firstName'-'lastName'-'email'-'mobilePhone'-'birthDate';
 end if;
 return new;
end $$;
drop trigger if exists club_accounts_strip_pd on public.club_accounts;
create trigger club_accounts_strip_pd before insert or update of data on public.club_accounts for each row execute function public.club_strip_account_pd();

create or replace function public.club_strip_profile_names() returns trigger language plpgsql set search_path=public as $$
begin new.first_name:=null;new.last_name:=null;return new; end $$;
drop trigger if exists profiles_strip_names on public.profiles;
create trigger profiles_strip_names before insert or update on public.profiles for each row execute function public.club_strip_profile_names();

update public.club_accounts set data=data-'firstName'-'lastName'-'email'-'mobilePhone'-'birthDate'
 where data is not null and jsonb_typeof(data)='object' and data ?| array['firstName','lastName','email','mobilePhone','birthDate'];
update public.profiles set first_name=null,last_name=null where first_name is not null or last_name is not null;

-- Online application form is closed: the guest registers at the reception.
create or replace function public.club_registration_submit(p_id uuid,p_user bigint,p_data jsonb,p_cipher text) returns uuid language plpgsql security definer set search_path=public as $$
begin
 raise exception 'Регистрация теперь в клубе: приходи на ресепшен (Мира, 37) с документом, администратор создаст аккаунт';
end $$;
notify pgrst,'reload schema';
commit;
