drop function if exists public.search_users(text);

create function public.search_users(search_text text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_color text,
  avatar_path text,
  is_admin boolean,
  badge text,
  is_banned boolean,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  query_text text := lower(trim(search_text));
  caller_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if char_length(query_text) < 3 then
    return;
  end if;

  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.public_id = 1
  ) into caller_is_admin;

  return query
  select
    profile.id,
    profile.username,
    profile.display_name,
    profile.avatar_color,
    profile.avatar_path,
    profile.public_id = 1,
    profile.badge,
    profile.is_banned,
    profile.last_seen_at
  from public.profiles profile
  where (profile.id <> auth.uid() or caller_is_admin)
    and (profile.is_banned = false or caller_is_admin)
    and profile.username = query_text
  limit 1;
end;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated;
