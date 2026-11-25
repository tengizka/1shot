create table public.club_data_exports (
    id uuid primary key,
    started_at timestamptz not null default clock_timestamp(),
    published_at timestamptz,
    totals jsonb,
    history jsonb
);

create table public.club_data_export_chunks (
    export_id uuid not null references public.club_data_exports(id) on delete cascade,
    sequence integer not null check (sequence >= 0),
    dataset text not null check (dataset in (
        'guests', 'guest_groups', 'stock', 'products', 'product_groups', 'hosts',
        'active_sessions', 'sessions', 'sales', 'guest_spending'
    )),
    rows jsonb not null check (jsonb_typeof(rows) = 'array'),
    primary key (export_id, sequence)
);

alter table public.club_data_exports enable row level security;
alter table public.club_data_export_chunks enable row level security;
revoke all on public.club_data_exports, public.club_data_export_chunks from public, anon, authenticated;
grant select on public.club_data_exports, public.club_data_export_chunks to service_role;

create function public.club_store_data_export(p_data jsonb) returns boolean
language plpgsql set search_path = '' as $$
declare
    v_id uuid := (p_data->>'export_id')::uuid;
    v_action text := p_data->>'action';
    v_export public.club_data_exports%rowtype;
    v_count integer;
    v_last integer;
    v_totals jsonb;
    v_actual jsonb;
begin
    perform pg_advisory_xact_lock(1618033, 20261125);

    if v_action = 'begin' then
        delete from public.club_data_exports
        where published_at is null and started_at < now() - interval '24 hours';
        insert into public.club_data_exports(id) values (v_id) on conflict do nothing;
        return true;
    end if;

    select * into v_export from public.club_data_exports where id = v_id;
    if not found then raise exception 'desk_export_not_started'; end if;

    if v_export.published_at is not null then
        if v_action = 'publish' then return true; end if;
        raise exception 'desk_export_already_published';
    end if;

    if v_action = 'append' then
        insert into public.club_data_export_chunks(export_id, sequence, dataset, rows)
        values (v_id, (p_data->>'sequence')::integer, p_data->>'dataset', p_data->'rows')
        on conflict (export_id, sequence) do update set dataset = excluded.dataset, rows = excluded.rows;
        return true;
    end if;

    if v_action is distinct from 'publish' then raise exception 'desk_export_unknown_action'; end if;
    if exists (select 1 from public.club_data_exports
               where published_at is not null and started_at > v_export.started_at) then
        raise exception 'desk_export_newer_snapshot';
    end if;

    select count(*), max(sequence) into v_count, v_last
    from public.club_data_export_chunks where export_id = v_id;
    select coalesce(jsonb_object_agg(dataset, row_count), '{}'::jsonb) into v_actual
    from (
        select dataset, sum(jsonb_array_length(rows)) as row_count
        from public.club_data_export_chunks where export_id = v_id group by dataset
    ) as counts;

    v_totals := p_data->'totals';
    if v_count is distinct from (p_data->>'batch_count')::integer
       or coalesce(v_last, -1) <> v_count - 1
       or jsonb_typeof(v_totals) is distinct from 'object'
       or exists (
           select 1
           from jsonb_each(v_actual) as actual(dataset, total)
           full join jsonb_each(v_totals) as expected(dataset, total) using (dataset)
           where coalesce(actual.total, '0'::jsonb) is distinct from coalesce(expected.total, '0'::jsonb)
       ) then
        raise exception 'desk_export_incomplete';
    end if;

    update public.club_data_exports
    set published_at = clock_timestamp(), totals = v_totals, history = p_data->'history'
    where id = v_id;
    delete from public.club_data_exports
    where id <> v_id and started_at <= v_export.started_at;
    return true;
end;
$$;
revoke all on function public.club_store_data_export(jsonb) from public, anon, authenticated;

create or replace function public.club_desk_report(p_worker uuid, p_kind text, p_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
    if not exists(select 1 from club_worker where worker_id = p_worker and lease_until > now()) then
        raise exception 'worker_lease_expired';
    end if;
    if length(p_data::text) > 500000 then raise exception 'report_too_large'; end if;
    if p_kind = 'desk_data_export' then
        return public.club_store_data_export(p_data);
    end if;
    insert into club_desk_reports(kind, data, updated_at) values (p_kind, p_data, now())
    on conflict (kind) do update set data = excluded.data, updated_at = now();
    return true;
end;
$$;
