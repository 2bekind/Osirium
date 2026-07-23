drop function if exists public.search_users(text);

create function public.search_users(search_text text)
returns table (
  id uuid, username text, display_name text, avatar_color text, avatar_path text,
  is_admin boolean, badge text, is_banned boolean, last_seen_at timestamptz,
  prime_plan text, nickname_icon text, nickname_color text, nickname_font text
)
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
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path,
    p.public_id = 1, p.badge, p.is_banned, p.last_seen_at,
    subscription.plan,
    case when subscription.plan in ('medium', 'extra') then p.nickname_icon else null end,
    case when subscription.plan = 'extra' then p.nickname_color else null end,
    case when subscription.plan = 'extra' then p.nickname_font else null end
  from public.profiles p
  left join public.star_subscriptions subscription
    on subscription.user_id = p.id and subscription.expires_at > now()
  where p.id <> auth.uid()
    and (p.is_banned = false or exists (select 1 from public.profiles admin_profile where admin_profile.id = auth.uid() and admin_profile.public_id = 1))
    and p.username = query_text
  limit 1;
end;
$$;

drop function if exists public.list_direct_conversations();

create function public.list_direct_conversations()
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
      and not (own.blocked_at is not null and m.sender_id = other_member.user_id and m.created_at >= own.blocked_at)
    order by m.created_at desc limit 1
  ) last_message on true
  where c.is_group = false and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  order by (own.pinned_at is not null) desc, own.pinned_at desc nulls last, last_message.created_at desc nulls last, c.created_at desc;
end;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated;
revoke all on function public.list_direct_conversations() from public;
grant execute on function public.list_direct_conversations() to authenticated;
