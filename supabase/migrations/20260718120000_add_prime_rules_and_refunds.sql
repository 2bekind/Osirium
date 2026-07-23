create table if not exists public.prime_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('light', 'medium', 'extra')),
  amount bigint not null check (amount in (100, 150, 300)),
  period_started_at timestamptz not null,
  period_expires_at timestamptz not null,
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz
);

create index if not exists prime_payments_user_created_idx on public.prime_payments (user_id, purchased_at desc);
alter table public.prime_payments enable row level security;

drop policy if exists "users can read own prime payments" on public.prime_payments;
create policy "users can read own prime payments" on public.prime_payments
  for select to authenticated using (user_id = auth.uid());

create or replace function public.purchase_star_subscription(p_plan text)
returns table (plan text, expires_at timestamptz, osi_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  price bigint;
  active_plan text;
  active_expiry timestamptz;
  next_expiry timestamptz;
  next_balance bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  price := case p_plan when 'light' then 100 when 'medium' then 150 when 'extra' then 300 else null end;
  if price is null then raise exception 'Unknown Prime plan' using errcode = '22023'; end if;

  select subscription.plan, subscription.expires_at
  into active_plan, active_expiry
  from public.star_subscriptions subscription
  where subscription.user_id = auth.uid() and subscription.expires_at > now()
  for update;

  if active_plan is not null and active_plan <> p_plan then
    raise exception 'Active Prime plan can only be renewed until it expires' using errcode = '22023';
  end if;

  select profile.osi_balance into next_balance
  from public.profiles profile
  where profile.id = auth.uid()
  for update;

  if next_balance is null or next_balance < price then raise exception 'Not enough Osi' using errcode = '22023'; end if;

  next_expiry := coalesce(active_expiry, now()) + interval '30 days';

  update public.profiles profile
  set osi_balance = profile.osi_balance - price
  where profile.id = auth.uid()
  returning profile.osi_balance into next_balance;

  insert into public.star_subscriptions (user_id, plan, starts_at, expires_at)
  values (auth.uid(), p_plan, now(), next_expiry)
  on conflict (user_id) do update
  set plan = excluded.plan,
      expires_at = excluded.expires_at;

  insert into public.prime_payments (user_id, plan, amount, period_started_at, period_expires_at)
  values (auth.uid(), p_plan, price, coalesce(active_expiry, now()), next_expiry);

  return query select p_plan, next_expiry, next_balance;
end;
$$;

create or replace function public.refund_prime_subscription()
returns table (osi_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  payment public.prime_payments%rowtype;
  next_balance bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select candidate.* into payment
  from public.prime_payments candidate
  where candidate.user_id = auth.uid()
    and candidate.refunded_at is null
    and candidate.purchased_at >= now() - interval '48 hours'
  order by candidate.purchased_at desc
  limit 1
  for update;

  if payment.id is null then raise exception 'Prime refund period has ended' using errcode = '22023'; end if;

  update public.prime_payments
  set refunded_at = now()
  where id = payment.id;

  update public.profiles profile
  set osi_balance = profile.osi_balance + payment.amount
  where profile.id = auth.uid()
  returning profile.osi_balance into next_balance;

  if payment.period_started_at <= payment.purchased_at + interval '5 seconds' then
    delete from public.star_subscriptions where user_id = auth.uid();
  else
    update public.star_subscriptions
    set expires_at = payment.period_started_at
    where user_id = auth.uid();
  end if;

  return query select next_balance;
end;
$$;

create or replace function public.get_my_prime_profile()
returns table (
  referral_code text,
  invited_count integer,
  osi_balance bigint,
  birthday date,
  plan text,
  expires_at timestamptz,
  nickname_icon text,
  nickname_color text,
  nickname_font text,
  refundable_amount bigint,
  refund_available_until timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select profile.referral_code,
         (select count(*)::integer from public.referrals referral where referral.inviter_id = profile.id),
         profile.osi_balance,
         profile.birthday,
         subscription.plan,
         subscription.expires_at,
         profile.nickname_icon,
         profile.nickname_color,
         profile.nickname_font,
         payment.amount,
         payment.purchased_at + interval '48 hours'
  from public.profiles profile
  left join public.star_subscriptions subscription
    on subscription.user_id = profile.id and subscription.expires_at > now()
  left join lateral (
    select candidate.amount, candidate.purchased_at
    from public.prime_payments candidate
    where candidate.user_id = profile.id
      and candidate.refunded_at is null
      and candidate.purchased_at >= now() - interval '48 hours'
    order by candidate.purchased_at desc
    limit 1
  ) payment on true
  where profile.id = auth.uid();
$$;

revoke all on function public.refund_prime_subscription() from public;
grant execute on function public.refund_prime_subscription() to authenticated;
revoke all on function public.get_my_prime_profile() from public;
grant execute on function public.get_my_prime_profile() to authenticated;
