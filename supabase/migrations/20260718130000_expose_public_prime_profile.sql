drop function if exists public.get_public_profile(uuid);

create function public.get_public_profile(p_user_id uuid)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_color text,
  avatar_path text,
  bio text,
  is_admin boolean,
  badge text,
  last_seen_at timestamptz,
  prime_plan text,
  nickname_icon text,
  nickname_color text,
  nickname_font text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.username,
    profile.display_name,
    profile.avatar_color,
    profile.avatar_path,
    profile.bio,
    profile.public_id = 1,
    profile.badge,
    profile.last_seen_at,
    subscription.plan,
    case when subscription.plan is null then null else profile.nickname_icon end,
    case when subscription.plan = 'extra' then profile.nickname_color else null end,
    case when subscription.plan = 'extra' then profile.nickname_font else null end
  from public.profiles profile
  left join public.star_subscriptions subscription
    on subscription.user_id = profile.id
   and subscription.expires_at > now()
  where profile.id = p_user_id
    and profile.is_banned = false;
end;
$$;

revoke all on function public.get_public_profile(uuid) from public;
grant execute on function public.get_public_profile(uuid) to authenticated;
