create table if not exists public.manual_osi_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  payer_name text not null check (char_length(trim(payer_name)) between 2 and 80),
  osi_amount bigint not null check (osi_amount between 20 and 1000000),
  rub_amount numeric(12, 2) not null check (rub_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists manual_osi_topups_one_pending_per_user_idx
  on public.manual_osi_topups (user_id)
  where status = 'pending';

create index if not exists manual_osi_topups_pending_created_idx
  on public.manual_osi_topups (created_at asc)
  where status = 'pending';

alter table public.manual_osi_topups enable row level security;

create or replace function public.request_manual_osi_topup(p_osi_amount bigint, p_payer_name text)
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

create or replace function public.list_pending_manual_osi_topups()
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
  select request.id, request.user_id, profile.username, profile.display_name, request.payer_name,
    request.osi_amount, request.rub_amount, request.created_at
  from public.manual_osi_topups request
  join public.profiles profile on profile.id = request.user_id
  where request.status = 'pending'
  order by request.created_at asc;
end;
$$;

create or replace function public.review_manual_osi_topup(p_request_id uuid, p_approve boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.manual_osi_topups%rowtype;
  next_balance bigint;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.public_id = 1
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select request.* into request_row
  from public.manual_osi_topups request
  where request.id = p_request_id and request.status = 'pending'
  for update;
  if not found then
    raise exception 'Topup request is unavailable' using errcode = '22023';
  end if;

  update public.manual_osi_topups request
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where request.id = request_row.id;

  if p_approve then
    update public.profiles profile
    set osi_balance = profile.osi_balance + request_row.osi_amount
    where profile.id = request_row.user_id
    returning profile.osi_balance into next_balance;
  end if;

  return next_balance;
end;
$$;

revoke all on function public.request_manual_osi_topup(bigint, text) from public;
revoke all on function public.list_pending_manual_osi_topups() from public;
revoke all on function public.review_manual_osi_topup(uuid, boolean) from public;
grant execute on function public.request_manual_osi_topup(bigint, text) to authenticated;
grant execute on function public.list_pending_manual_osi_topups() to authenticated;
grant execute on function public.review_manual_osi_topup(uuid, boolean) to authenticated;
