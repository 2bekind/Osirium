alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists birthday date,
  add column if not exists nickname_icon text,
  add column if not exists nickname_color text,
  add column if not exists nickname_font text;

update public.profiles
set referral_code = 'OS-' || lpad(public_id::text, 12, '0')
where referral_code is null and public_id is not null;

create or replace function public.set_profile_referral_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.referral_code is null and new.public_id is not null then
    new.referral_code := 'OS-' || lpad(new.public_id::text, 12, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists set_profile_referral_code on public.profiles;
create trigger set_profile_referral_code
before insert or update of public_id on public.profiles
for each row execute function public.set_profile_referral_code();
create unique index if not exists profiles_referral_code_unique_idx on public.profiles (referral_code);

create table if not exists public.referrals (
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  reward_osi integer not null default 5 check (reward_osi = 5)
);

create index if not exists referrals_inviter_id_idx on public.referrals (inviter_id, created_at desc);

create table if not exists public.star_subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('light', 'medium', 'extra')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.referrals enable row level security;
alter table public.star_subscriptions enable row level security;

drop policy if exists "users can read own referrals" on public.referrals;
create policy "users can read own referrals" on public.referrals
  for select to authenticated using (inviter_id = auth.uid());

drop policy if exists "users can read own star subscription" on public.star_subscriptions;
create policy "users can read own star subscription" on public.star_subscriptions
  for select to authenticated using (user_id = auth.uid());

create or replace function public.apply_referral_invite(p_new_user_id uuid, p_referral_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter uuid;
begin
  if p_new_user_id is null or nullif(trim(p_referral_code), '') is null then return false; end if;
  select id into inviter
  from public.profiles
  where referral_code = upper(trim(p_referral_code))
  for update;
  if inviter is null or inviter = p_new_user_id then return false; end if;
  if exists (select 1 from public.referrals where invitee_id = p_new_user_id) then return false; end if;
  if (select count(*) from public.referrals where inviter_id = inviter) >= 3 then return false; end if;
  insert into public.referrals (inviter_id, invitee_id) values (inviter, p_new_user_id);
  update public.profiles set osi_balance = osi_balance + 5 where id = inviter;
  return true;
end;
$$;

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
  select profile.osi_balance into next_balance from public.profiles profile where profile.id = auth.uid() for update;
  if next_balance is null or next_balance < price then raise exception 'Not enough Osi' using errcode = '22023'; end if;
  select greatest(coalesce(subscription.expires_at, now()), now()) + interval '30 days' into next_expiry from public.star_subscriptions subscription where subscription.user_id = auth.uid();
  if next_expiry is null then next_expiry := now() + interval '30 days'; end if;
  update public.profiles profile set osi_balance = profile.osi_balance - price where profile.id = auth.uid() returning profile.osi_balance into next_balance;
  insert into public.star_subscriptions (user_id, plan, starts_at, expires_at)
  values (auth.uid(), p_plan, now(), next_expiry)
  on conflict (user_id) do update set plan = excluded.plan, expires_at = excluded.expires_at;
  return query select p_plan, next_expiry, next_balance;
end;
$$;

create or replace function public.update_star_profile_style(p_icon text, p_color text, p_font text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare active_plan text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select plan into active_plan from public.star_subscriptions where user_id = auth.uid() and expires_at > now();
  if active_plan is null then raise exception 'Star subscription required' using errcode = '42501'; end if;
  if p_icon is not null and p_icon not in ('star', 'sparkle', 'moon', 'wave', 'heart') then raise exception 'Unknown icon' using errcode = '22023'; end if;
  if active_plan = 'light' and (nullif(p_color, '') is not null or nullif(p_font, '') is not null) then raise exception 'This style requires Extra' using errcode = '42501'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid color' using errcode = '22023'; end if;
  if p_font is not null and p_font not in ('manrope', 'serif', 'mono') then raise exception 'Invalid font' using errcode = '22023'; end if;
  update public.profiles
  set nickname_icon = nullif(p_icon, ''),
      nickname_color = case when active_plan = 'extra' then nullif(p_color, '') else null end,
      nickname_font = case when active_plan = 'extra' then nullif(p_font, '') else null end
  where id = auth.uid();
end;
$$;

create or replace function public.set_my_birthday(p_birthday date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_birthday is not null and (p_birthday < date '1900-01-01' or p_birthday > current_date) then raise exception 'Invalid birthday' using errcode = '22023'; end if;
  update public.profiles set birthday = p_birthday where id = auth.uid();
end;
$$;

create or replace function public.get_my_star_profile()
returns table (referral_code text, invited_count integer, osi_balance bigint, birthday date, plan text, expires_at timestamptz, nickname_icon text, nickname_color text, nickname_font text)
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
         profile.nickname_font
  from public.profiles profile
  left join public.star_subscriptions subscription on subscription.user_id = profile.id and subscription.expires_at > now()
  where profile.id = auth.uid();
$$;

revoke all on function public.apply_referral_invite(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_referral_invite(uuid, text) to service_role;
revoke all on function public.purchase_star_subscription(text) from public;
grant execute on function public.purchase_star_subscription(text) to authenticated;
revoke all on function public.update_star_profile_style(text, text, text) from public;
grant execute on function public.update_star_profile_style(text, text, text) to authenticated;
revoke all on function public.set_my_birthday(date) from public;
grant execute on function public.set_my_birthday(date) to authenticated;
revoke all on function public.get_my_star_profile() from public;
grant execute on function public.get_my_star_profile() to authenticated;
