alter table public.direct_conversation_preferences
  add column if not exists cleared_at timestamptz;

create or replace function public.clear_direct_conversation_for_me(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  insert into public.direct_conversation_preferences (conversation_id, user_id, cleared_at, pinned_at)
  values (p_conversation_id, auth.uid(), now(), null)
  on conflict (conversation_id, user_id) do update
    set cleared_at = excluded.cleared_at,
        pinned_at = null;
end;
$$;

create or replace function public.delete_direct_conversation_for_everyone(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  delete from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.is_group = false
    and (
      select count(*)
      from public.conversation_members member
      where member.conversation_id = conversation.id
    ) = 2;

  if not found then
    raise exception 'Direct conversation not found' using errcode = '22023';
  end if;
end;
$$;

drop function if exists public.list_direct_conversations();

create or replace function public.list_direct_conversations()
returns table (
  conversation_id uuid, other_user_id uuid, username text, display_name text,
  avatar_color text, avatar_path text, is_admin boolean, badge text,
  last_seen_at timestamptz, last_body text, last_created_at timestamptz, last_sender_id uuid,
  is_pinned boolean, is_muted boolean, is_blocked boolean, block_hidden boolean, blocked_by_other boolean, hidden_presence_since timestamptz,
  prime_plan text, nickname_icon text, nickname_color text, nickname_font text
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
    p.last_seen_at, last_message.body, last_message.created_at, last_message.sender_id,
    own.pinned_at is not null, coalesce(own.muted, false), own.blocked_at is not null, coalesce(own.block_hidden, false),
    other_preferences.blocked_at is not null and not other_preferences.block_hidden,
    case when own.blocked_at is not null and own.block_hidden then own.blocked_at else null end,
    subscription.plan,
    case when subscription.plan in ('medium', 'extra') then p.nickname_icon else null end,
    case when subscription.plan = 'extra' then p.nickname_color else null end,
    case when subscription.plan = 'extra' then p.nickname_font else null end
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
  join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
  join public.profiles p on p.id = other_member.user_id
  left join public.star_subscriptions subscription on subscription.user_id = p.id and subscription.expires_at > now()
  left join public.direct_conversation_preferences own on own.conversation_id = c.id and own.user_id = auth.uid()
  left join public.direct_conversation_preferences other_preferences on other_preferences.conversation_id = c.id and other_preferences.user_id = other_member.user_id
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
      and (own.cleared_at is null or m.created_at > own.cleared_at)
      and not (own.blocked_at is not null and m.sender_id = other_member.user_id and m.created_at >= own.blocked_at)
    order by m.created_at desc
    limit 1
  ) last_message on true
  where c.is_group = false
    and (select count(*) from public.conversation_members member where member.conversation_id = c.id) = 2
    and (own.cleared_at is null or last_message.created_at is not null)
  order by (own.pinned_at is not null) desc, own.pinned_at desc nulls last, last_message.created_at desc nulls last, c.created_at desc;
end;
$$;

drop function if exists public.list_messages(uuid);

create or replace function public.list_messages(p_conversation_id uuid)
returns table (
  id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz,
  image_path text, image_name text, audio_path text, audio_name text, audio_duration integer,
  reply_to_id uuid, reply_body text, reply_sender_id uuid, forwarded_from_id uuid, edited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;

  return query
  select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name, m.audio_path, m.audio_name, m.audio_duration,
    m.reply_to_id, replied.body, replied.sender_id, m.forwarded_from_id, m.edited_at
  from public.messages m
  left join public.messages replied on replied.id = m.reply_to_id
  left join public.direct_conversation_preferences own on own.conversation_id = p_conversation_id and own.user_id = auth.uid()
  where m.conversation_id = p_conversation_id
    and (own.cleared_at is null or m.created_at > own.cleared_at)
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
    and not (own.blocked_at is not null and m.sender_id <> auth.uid() and m.created_at >= own.blocked_at)
  order by m.created_at asc;
end;
$$;

revoke all on function public.clear_direct_conversation_for_me(uuid) from public;
revoke all on function public.delete_direct_conversation_for_everyone(uuid) from public;
grant execute on function public.clear_direct_conversation_for_me(uuid) to authenticated;
grant execute on function public.delete_direct_conversation_for_everyone(uuid) to authenticated;
