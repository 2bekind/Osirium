-- Presence is approximate: a user is online while their client refreshes this timestamp.
alter table public.profiles add column if not exists last_seen_at timestamptz not null default now();

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid()
    and last_seen_at < now() - interval '20 seconds';
end;
$$;

drop function if exists public.search_users(text);
create function public.search_users(search_text text)
returns table (id uuid, username text, display_name text, avatar_color text, avatar_path text, is_admin boolean, badge text, is_banned boolean, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  query_text text := lower(trim(search_text));
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if char_length(query_text) < 3 then return; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge, p.is_banned, p.last_seen_at
  from public.profiles p
  where p.id <> auth.uid()
    and (p.is_banned = false or exists (select 1 from public.profiles admin_profile where admin_profile.id = auth.uid() and admin_profile.public_id = 1))
    and p.username like query_text || '%'
  order by p.username
  limit 20;
end;
$$;

drop function if exists public.get_public_profile(uuid);
create function public.get_public_profile(p_user_id uuid)
returns table (id uuid, username text, display_name text, avatar_color text, avatar_path text, bio text, is_admin boolean, badge text, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.bio, p.public_id = 1, p.badge, p.last_seen_at
  from public.profiles p
  where p.id = p_user_id and p.is_banned = false;
end;
$$;

drop function if exists public.list_direct_conversations();
create function public.list_direct_conversations()
returns table (
  conversation_id uuid, other_user_id uuid, username text, display_name text,
  avatar_color text, avatar_path text, is_admin boolean, badge text,
  last_seen_at timestamptz, last_body text, last_created_at timestamptz, last_sender_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select c.id, other_member.user_id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge,
    p.last_seen_at, last_message.body, last_message.created_at, last_message.sender_id
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
  join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
  join public.profiles p on p.id = other_member.user_id
  left join lateral (
    select m.body, m.created_at, m.sender_id from public.messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) last_message on true
  where c.is_group = false
    and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  order by last_message.created_at desc nulls last, c.created_at desc;
end;
$$;

revoke all on function public.touch_presence() from public;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.search_users(text) to authenticated;
grant execute on function public.get_public_profile(uuid) to authenticated;
grant execute on function public.list_direct_conversations() to authenticated;
