create or replace function public.admin_grant_prime_subscription(p_user_id uuid, p_plan text)
returns table (plan text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_plan text;
  active_expiry timestamptz;
  active_rank integer;
  requested_rank integer;
  next_expiry timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid() and profile.public_id = 1
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  requested_rank := case p_plan
    when 'light' then 1
    when 'medium' then 2
    when 'extra' then 3
    else null
  end;
  if requested_rank is null then
    raise exception 'Invalid Prime plan' using errcode = '22023';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = p_user_id and profile.is_banned = false
  for update;
  if not found then
    raise exception 'User not found or banned' using errcode = '22023';
  end if;

  select subscription.plan, subscription.expires_at
  into active_plan, active_expiry
  from public.star_subscriptions subscription
  where subscription.user_id = p_user_id and subscription.expires_at > now()
  for update;

  if active_plan is not null then
    active_rank := case active_plan
      when 'light' then 1
      when 'medium' then 2
      when 'extra' then 3
      else 0
    end;
    if active_rank > requested_rank then
      raise exception 'User already has a higher Prime plan' using errcode = '22023';
    end if;
  end if;

  next_expiry := coalesce(active_expiry, now()) + interval '30 days';

  insert into public.star_subscriptions (user_id, plan, starts_at, expires_at)
  values (p_user_id, p_plan, now(), next_expiry)
  on conflict (user_id) do update
  set plan = excluded.plan,
      expires_at = excluded.expires_at;

  return query select p_plan, next_expiry;
end;
$$;

revoke all on function public.admin_grant_prime_subscription(uuid, text) from public;
grant execute on function public.admin_grant_prime_subscription(uuid, text) to authenticated;
