alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists forwarded_from_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'ice', 'hangup', 'decline')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists call_signals_recipient_idx on public.call_signals (recipient_id, created_at desc);
alter table public.call_signals enable row level security;
drop policy if exists "call participants read signals" on public.call_signals;
drop policy if exists "call participants send signals" on public.call_signals;
drop policy if exists "call participants clear signals" on public.call_signals;
create policy "call participants read signals" on public.call_signals for select to authenticated using (auth.uid() in (sender_id, recipient_id));
create policy "call participants send signals" on public.call_signals for insert to authenticated with check (
  auth.uid() = sender_id
  and public.is_conversation_member(conversation_id)
  and exists (select 1 from public.conversation_members where conversation_id = call_signals.conversation_id and user_id = recipient_id)
);
create policy "call participants clear signals" on public.call_signals for delete to authenticated using (auth.uid() in (sender_id, recipient_id));
alter publication supabase_realtime add table public.call_signals;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('badge', 'ban', 'osi')),
  previous_state jsonb not null,
  next_state jsonb not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

drop function if exists public.list_messages(uuid);
create function public.list_messages(p_conversation_id uuid)
returns table (
  id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz,
  image_path text, image_name text, audio_path text, audio_name text, audio_duration integer,
  reply_to_id uuid, reply_body text, reply_sender_id uuid, forwarded_from_id uuid, edited_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query
  select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name, m.audio_path, m.audio_name, m.audio_duration,
    m.reply_to_id, replied.body, replied.sender_id, m.forwarded_from_id, m.edited_at
  from public.messages m
  left join public.messages replied on replied.id = m.reply_to_id
  left join public.direct_conversation_preferences own on own.conversation_id = p_conversation_id and own.user_id = auth.uid()
  where m.conversation_id = p_conversation_id
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
    and not (own.blocked_at is not null and m.sender_id <> auth.uid() and m.created_at >= own.blocked_at)
  order by m.created_at asc;
end;
$$;

drop function if exists public.send_direct_message(uuid, text);
create function public.send_direct_message(p_conversation_id uuid, p_body text, p_reply_to_id uuid default null, p_forwarded_from_id uuid default null)
returns table (
  id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz,
  image_path text, image_name text, audio_path text, audio_name text, audio_duration integer,
  reply_to_id uuid, reply_body text, reply_sender_id uuid, forwarded_from_id uuid, edited_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare clean_body text := left(trim(p_body), 500); created_message public.messages;
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if char_length(clean_body) not between 1 and 500 then raise exception 'Invalid message' using errcode = '22023'; end if;
  if p_reply_to_id is not null and not exists (select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id) then raise exception 'Invalid reply' using errcode = '22023'; end if;
  insert into public.messages (conversation_id, sender_id, body, reply_to_id, forwarded_from_id)
  values (p_conversation_id, auth.uid(), clean_body, p_reply_to_id, p_forwarded_from_id)
  returning * into created_message;
  return query select created_message.id, created_message.sender_id, created_message.body, created_message.created_at, created_message.read_at,
    created_message.image_path, created_message.image_name, created_message.audio_path, created_message.audio_name, created_message.audio_duration,
    created_message.reply_to_id, replied.body, replied.sender_id, created_message.forwarded_from_id, created_message.edited_at
  from public.messages replied where replied.id = created_message.reply_to_id
  union all select created_message.id, created_message.sender_id, created_message.body, created_message.created_at, created_message.read_at,
    created_message.image_path, created_message.image_name, created_message.audio_path, created_message.audio_name, created_message.audio_duration,
    created_message.reply_to_id, null, null, created_message.forwarded_from_id, created_message.edited_at
  where created_message.reply_to_id is null;
end;
$$;

create or replace function public.edit_direct_message(p_message_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare clean_body text := left(trim(p_body), 500);
begin
  if char_length(clean_body) not between 1 and 500 then raise exception 'Invalid message' using errcode = '22023'; end if;
  update public.messages set body = clean_body, edited_at = now()
  where id = p_message_id and sender_id = auth.uid() and image_path is null and audio_path is null
    and public.is_conversation_member(conversation_id);
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;
end;
$$;

create or replace function public.admin_set_badge(p_user_id uuid, p_badge text)
returns void language plpgsql security definer set search_path = public as $$
declare previous_badge text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_badge is not null and p_badge not in ('helper', 'idea') then raise exception 'Invalid badge' using errcode = '22023'; end if;
  select badge into previous_badge from public.profiles where id = p_user_id and public_id <> 1 for update;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;
  update public.profiles set badge = p_badge where id = p_user_id;
  insert into public.admin_audit_log (actor_id, target_user_id, action, previous_state, next_state)
  values (auth.uid(), p_user_id, 'badge', jsonb_build_object('badge', previous_badge), jsonb_build_object('badge', p_badge));
end;
$$;

create or replace function public.admin_set_ban(p_user_id uuid, p_is_banned boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare previous_banned boolean; previous_reason text; next_reason text := case when p_is_banned then left(nullif(trim(p_reason), ''), 240) else null end;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then raise exception 'Forbidden' using errcode = '42501'; end if;
  select is_banned, ban_reason into previous_banned, previous_reason from public.profiles where id = p_user_id and public_id <> 1 for update;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;
  update public.profiles set is_banned = p_is_banned, ban_reason = next_reason where id = p_user_id;
  insert into public.admin_audit_log (actor_id, target_user_id, action, previous_state, next_state)
  values (auth.uid(), p_user_id, 'ban', jsonb_build_object('is_banned', previous_banned, 'reason', previous_reason), jsonb_build_object('is_banned', p_is_banned, 'reason', next_reason));
end;
$$;

create or replace function public.admin_grant_osi(p_user_id uuid, p_amount bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare next_balance bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_amount <= 0 or p_amount > 1000000000 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  update public.profiles set osi_balance = osi_balance + p_amount where id = p_user_id and public_id <> 1 returning osi_balance into next_balance;
  if next_balance is null then raise exception 'User not found' using errcode = '22023'; end if;
  insert into public.admin_audit_log (actor_id, target_user_id, action, previous_state, next_state)
  values (auth.uid(), p_user_id, 'osi', jsonb_build_object('delta', p_amount), jsonb_build_object('balance', next_balance));
  return next_balance;
end;
$$;

create function public.list_admin_audit_log()
returns table (id uuid, action text, target_user_id uuid, username text, display_name text, previous_state jsonb, next_state jsonb, created_at timestamptz, undone_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query select log.id, log.action, log.target_user_id, profile.username, profile.display_name, log.previous_state, log.next_state, log.created_at, log.undone_at
  from public.admin_audit_log log join public.profiles profile on profile.id = log.target_user_id order by log.created_at desc limit 50;
end;
$$;

create function public.undo_admin_audit_action(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare entry public.admin_audit_log;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into entry from public.admin_audit_log where id = p_log_id and undone_at is null for update;
  if not found then raise exception 'Action is unavailable' using errcode = '22023'; end if;
  if entry.action = 'badge' then update public.profiles set badge = entry.previous_state->>'badge' where id = entry.target_user_id;
  elsif entry.action = 'ban' then update public.profiles set is_banned = coalesce((entry.previous_state->>'is_banned')::boolean, false), ban_reason = entry.previous_state->>'reason' where id = entry.target_user_id;
  elsif entry.action = 'osi' then update public.profiles set osi_balance = osi_balance - (entry.previous_state->>'delta')::bigint where id = entry.target_user_id and osi_balance >= (entry.previous_state->>'delta')::bigint;
    if not found then raise exception 'Balance changed, this action cannot be undone' using errcode = '22023'; end if;
  end if;
  update public.admin_audit_log set undone_at = now() where id = entry.id;
end;
$$;

revoke all on function public.edit_direct_message(uuid, text) from public;
revoke all on function public.list_admin_audit_log() from public;
revoke all on function public.undo_admin_audit_action(uuid) from public;
grant execute on function public.list_messages(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.edit_direct_message(uuid, text) to authenticated;
grant execute on function public.list_admin_audit_log() to authenticated;
grant execute on function public.undo_admin_audit_action(uuid) to authenticated;
