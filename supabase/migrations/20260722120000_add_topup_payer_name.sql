alter table public.manual_osi_topups
  add column if not exists payer_name text;

update public.manual_osi_topups
set payer_name = 'Не указано'
where payer_name is null or char_length(trim(payer_name)) = 0;

alter table public.manual_osi_topups
  alter column payer_name set not null;

alter table public.manual_osi_topups
  drop constraint if exists manual_osi_topups_payer_name_check;

alter table public.manual_osi_topups
  add constraint manual_osi_topups_payer_name_check
  check (char_length(trim(payer_name)) between 2 and 80);

alter table public.manual_osi_topups
  drop constraint if exists manual_osi_topups_osi_amount_check;

alter table public.manual_osi_topups
  add constraint manual_osi_topups_osi_amount_check
  check (osi_amount between 20 and 1000000);

drop function if exists public.request_manual_osi_topup(bigint);
drop function if exists public.request_manual_osi_topup(bigint, text);

create function public.request_manual_osi_topup(p_osi_amount bigint, p_payer_name text)
returns table (id uuid, osi_amount bigint, rub_amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.manual_osi_topups%rowtype;
  normalized_payer_name text := left(trim(coalesce(p_payer_name, '')), 80);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_osi_amount < 20 or p_osi_amount > 1000000 then
    raise exception 'Invalid Osi amount' using errcode = '22023';
  end if;
  if char_length(normalized_payer_name) < 2 then
    raise exception 'Invalid payer name' using errcode = '22023';
  end if;

  insert into public.manual_osi_topups (user_id, payer_name, osi_amount, rub_amount)
  values (auth.uid(), normalized_payer_name, p_osi_amount, p_osi_amount * 0.5)
  returning * into request_row;

  return query select request_row.id, request_row.osi_amount, request_row.rub_amount;
exception
  when unique_violation then
    raise exception 'Pending topup already exists' using errcode = '23505';
end;
$$;

drop function if exists public.list_pending_manual_osi_topups();

create function public.list_pending_manual_osi_topups()
returns table (
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  payer_name text,
  osi_amount bigint,
  rub_amount numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.public_id = 1
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select request.id, request.user_id, profile.username, profile.display_name,
    request.payer_name, request.osi_amount, request.rub_amount, request.created_at
  from public.manual_osi_topups request
  join public.profiles profile on profile.id = request.user_id
  where request.status = 'pending'
  order by request.created_at asc;
end;
$$;

revoke all on function public.request_manual_osi_topup(bigint, text) from public;
revoke all on function public.list_pending_manual_osi_topups() from public;
grant execute on function public.request_manual_osi_topup(bigint, text) to authenticated;
grant execute on function public.list_pending_manual_osi_topups() to authenticated;
