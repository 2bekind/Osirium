create table if not exists public.direct_conversation_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamptz,
  muted boolean not null default false,
  blocked_at timestamptz,
  block_hidden boolean not null default false,
  primary key (conversation_id, user_id)
);

create index if not exists direct_conversation_preferences_user_idx on public.direct_conversation_preferences (user_id, pinned_at desc);
alter table public.direct_conversation_preferences enable row level security;

create or replace function public.toggle_direct_conversation_pin(p_conversation_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare next_pinned_at timestamptz;
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  insert into public.direct_conversation_preferences (conversation_id, user_id, pinned_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update
    set pinned_at = case when public.direct_conversation_preferences.pinned_at is null then now() else null end
  returning pinned_at into next_pinned_at;
  return next_pinned_at is not null;
end;
$$;

create or replace function public.toggle_direct_conversation_mute(p_conversation_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare next_muted boolean;
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  insert into public.direct_conversation_preferences (conversation_id, user_id, muted)
  values (p_conversation_id, auth.uid(), true)
  on conflict (conversation_id, user_id) do update
    set muted = not public.direct_conversation_preferences.muted
  returning muted into next_muted;
  return next_muted;
end;
$$;

create or replace function public.set_direct_conversation_block(p_conversation_id uuid, p_hidden boolean, p_blocked boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  insert into public.direct_conversation_preferences (conversation_id, user_id, blocked_at, block_hidden)
  values (p_conversation_id, auth.uid(), case when p_blocked then now() else null end, p_hidden)
  on conflict (conversation_id, user_id) do update
    set blocked_at = case when p_blocked then coalesce(public.direct_conversation_preferences.blocked_at, now()) else null end,
        block_hidden = case when p_blocked then p_hidden else false end;
end;
$$;

drop function if exists public.list_direct_conversations();
create function public.list_direct_conversations()
returns table (
  conversation_id uuid, other_user_id uuid, username text, display_name text,
  avatar_color text, avatar_path text, is_admin boolean, badge text,
  last_seen_at timestamptz, last_body text, last_created_at timestamptz, last_sender_id uuid,
  is_pinned boolean, is_muted boolean, is_blocked boolean, block_hidden boolean, blocked_by_other boolean, hidden_presence_since timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select c.id, other_member.user_id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge,
    p.last_seen_at, last_message.body, last_message.created_at, last_message.sender_id,
    own.pinned_at is not null, coalesce(own.muted, false), own.blocked_at is not null, coalesce(own.block_hidden, false),
    other_preferences.blocked_at is not null and not other_preferences.block_hidden,
    case when own.blocked_at is not null and own.block_hidden then own.blocked_at else null end
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
  join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
  join public.profiles p on p.id = other_member.user_id
  left join public.direct_conversation_preferences own on own.conversation_id = c.id and own.user_id = auth.uid()
  left join public.direct_conversation_preferences other_preferences on other_preferences.conversation_id = c.id and other_preferences.user_id = other_member.user_id
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
      and not (own.blocked_at is not null and m.sender_id = other_member.user_id and m.created_at >= own.blocked_at)
    order by m.created_at desc limit 1
  ) last_message on true
  where c.is_group = false and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  order by (own.pinned_at is not null) desc, own.pinned_at desc nulls last, last_message.created_at desc nulls last, c.created_at desc;
end;
$$;

create or replace function public.list_messages(p_conversation_id uuid)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz, image_path text, image_name text, audio_path text, audio_name text, audio_duration integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query
  select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name, m.audio_path, m.audio_name, m.audio_duration
  from public.messages m
  left join public.direct_conversation_preferences own on own.conversation_id = p_conversation_id and own.user_id = auth.uid()
  where m.conversation_id = p_conversation_id
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
    and not (own.blocked_at is not null and m.sender_id <> auth.uid() and m.created_at >= own.blocked_at)
  order by m.created_at asc;
end;
$$;

revoke all on function public.toggle_direct_conversation_pin(uuid) from public;
revoke all on function public.toggle_direct_conversation_mute(uuid) from public;
revoke all on function public.set_direct_conversation_block(uuid, boolean, boolean) from public;
revoke all on function public.list_direct_conversations() from public;
grant execute on function public.toggle_direct_conversation_pin(uuid) to authenticated;
grant execute on function public.toggle_direct_conversation_mute(uuid) to authenticated;
grant execute on function public.set_direct_conversation_block(uuid, boolean, boolean) to authenticated;
grant execute on function public.list_direct_conversations() to authenticated;
