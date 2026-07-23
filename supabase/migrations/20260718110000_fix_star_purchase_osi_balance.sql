create or replace function public.purchase_star_subscription(p_plan text)
returns table (plan text, expires_at timestamptz, osi_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  price bigint;
  next_expiry timestamptz;
  next_balance bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  price := case p_plan when 'light' then 100 when 'medium' then 150 when 'extra' then 300 else null end;
  if price is null then raise exception 'Unknown Star plan' using errcode = '22023'; end if;

  select profile.osi_balance into next_balance
  from public.profiles profile
  where profile.id = auth.uid()
  for update;

  if next_balance is null or next_balance < price then raise exception 'Not enough Osi' using errcode = '22023'; end if;

  select greatest(coalesce(subscription.expires_at, now()), now()) + interval '30 days' into next_expiry
  from public.star_subscriptions subscription
  where subscription.user_id = auth.uid();

  if next_expiry is null then next_expiry := now() + interval '30 days'; end if;

  update public.profiles profile
  set osi_balance = profile.osi_balance - price
  where profile.id = auth.uid()
  returning profile.osi_balance into next_balance;

  insert into public.star_subscriptions (user_id, plan, starts_at, expires_at)
  values (auth.uid(), p_plan, now(), next_expiry)
  on conflict (user_id) do update
  set plan = excluded.plan,
      expires_at = excluded.expires_at;

  return query select p_plan, next_expiry, next_balance;
end;
$$;

grant execute on function public.purchase_star_subscription(text) to authenticated;
