-- Osirium: direct messaging, read receipts and private image attachments.
-- Run after supabase/schema.sql. It is safe to run again after a failed attempt.

create index if not exists conversation_members_user_id_idx on public.conversation_members (user_id, conversation_id);
create index if not exists messages_conversation_created_at_idx on public.messages (conversation_id, created_at);
create index if not exists profiles_username_lower_idx on public.profiles (lower(username));

create sequence if not exists public.profile_public_id_seq as bigint start with 1;
alter table public.profiles add column if not exists public_id bigint;
alter table public.profiles alter column public_id set default nextval('public.profile_public_id_seq');
with numbered_profiles as (
  select id, row_number() over (order by created_at asc, id asc)::bigint as next_public_id
  from public.profiles
  where public_id is null
)
update public.profiles profile
set public_id = numbered_profiles.next_public_id
from numbered_profiles
where profile.id = numbered_profiles.id;
select setval('public.profile_public_id_seq', coalesce((select max(public_id) from public.profiles), 0) + 1, false);
alter table public.profiles alter column public_id set not null;
create unique index if not exists profiles_public_id_unique_idx on public.profiles (public_id);

alter table public.messages add column if not exists read_at timestamptz;
alter table public.messages add column if not exists image_path text;
alter table public.messages add column if not exists image_name text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists bio text not null default '' check (char_length(bio) <= 160);
alter table public.profiles add column if not exists badge text check (badge in ('helper', 'idea'));
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists osi_balance bigint not null default 0 check (osi_balance >= 0);

create table if not exists public.message_pins (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.message_hidden_for (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_pins enable row level security;
alter table public.message_hidden_for enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users can upload own avatars" on storage.objects;
drop policy if exists "users can update own avatars" on storage.objects;
drop policy if exists "users can delete own avatars" on storage.objects;
create policy "users can upload own avatars" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "users can update own avatars" on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users can delete own avatars" on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.conversation_members
    join public.profiles on profiles.id = conversation_members.user_id
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
      and profiles.is_banned = false
  );
$$;

drop function if exists public.search_users(text);
create function public.search_users(search_text text)
returns table (id uuid, username text, display_name text, avatar_color text, avatar_path text, is_admin boolean, badge text, is_banned boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  query_text text := lower(trim(search_text));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if char_length(query_text) < 3 then
    return;
  end if;

  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge, p.is_banned
  from public.profiles p
  where p.id <> auth.uid()
    and (p.is_banned = false or exists (select 1 from public.profiles admin_profile where admin_profile.id = auth.uid() and admin_profile.public_id = 1))
    and p.username like query_text || '%'
  order by p.username
  limit 20;
end;
$$;

create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  direct_conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if other_user_id = current_user_id then
    raise exception 'Cannot create a conversation with yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select c.id into direct_conversation_id
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = current_user_id
  join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id = other_user_id
  where c.is_group = false
    and p.is_banned = false
    and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  limit 1;

  if direct_conversation_id is null then
    insert into public.conversations (is_group) values (false) returning id into direct_conversation_id;
    insert into public.conversation_members (conversation_id, user_id)
    values (direct_conversation_id, current_user_id), (direct_conversation_id, other_user_id);
  end if;
  return direct_conversation_id;
end;
$$;

drop function if exists public.get_public_profile(uuid);
create function public.get_public_profile(p_user_id uuid)
returns table (id uuid, username text, display_name text, avatar_color text, avatar_path text, bio text, is_admin boolean, badge text)
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
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.bio, p.public_id = 1, p.badge
  from public.profiles p
  where p.id = p_user_id and p.is_banned = false;
end;
$$;

drop function if exists public.admin_set_badge(uuid, text);
create function public.admin_set_badge(p_user_id uuid, p_badge text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_badge is not null and p_badge not in ('helper', 'idea') then
    raise exception 'Invalid badge' using errcode = '22023';
  end if;
  update public.profiles set badge = p_badge where id = p_user_id and public_id <> 1;
end;
$$;

drop function if exists public.admin_set_ban(uuid, boolean, text);
create function public.admin_set_ban(p_user_id uuid, p_is_banned boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.profiles
  set is_banned = p_is_banned,
      ban_reason = case when p_is_banned then left(nullif(trim(p_reason), ''), 240) else null end
  where id = p_user_id and public_id <> 1;
end;
$$;

drop function if exists public.admin_grant_osi(uuid, bigint);
create function public.admin_grant_osi(p_user_id uuid, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare next_balance bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  update public.profiles
  set osi_balance = osi_balance + p_amount
  where id = p_user_id and public_id <> 1
  returning osi_balance into next_balance;
  if next_balance is null then raise exception 'User not found' using errcode = '22023'; end if;
  return next_balance;
end;
$$;

drop function if exists public.list_direct_conversations();
create function public.list_direct_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  username text,
  display_name text,
  avatar_color text,
  avatar_path text,
  is_admin boolean,
  badge text,
  last_body text,
  last_created_at timestamptz,
  last_sender_id uuid
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
  select c.id, other_member.user_id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge,
    last_message.body, last_message.created_at, last_message.sender_id
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
  join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
  join public.profiles p on p.id = other_member.user_id
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) last_message on true
  where c.is_group = false
    and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  order by last_message.created_at desc nulls last, c.created_at desc;
end;
$$;

-- PostgreSQL does not let CREATE OR REPLACE change OUT columns.
drop function if exists public.list_messages(uuid);
drop function if exists public.send_direct_message(uuid, text);
drop function if exists public.send_image_message(uuid, text, text);
drop function if exists public.get_pinned_message(uuid);
drop function if exists public.toggle_direct_message_pin(uuid);
drop function if exists public.delete_direct_message(uuid, boolean);

create function public.list_messages(p_conversation_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  image_path text,
  image_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name
  from public.messages m
  where m.conversation_id = p_conversation_id
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
  order by m.created_at asc;
end;
$$;

create function public.get_pinned_message(p_conversation_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  image_path text,
  image_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name
  from public.message_pins pin
  join public.messages m on m.id = pin.message_id
  where pin.conversation_id = p_conversation_id
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
  limit 1;
end;
$$;

create function public.toggle_direct_message_pin(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_conversation_id uuid;
begin
  select conversation_id into target_conversation_id from public.messages where id = p_message_id;
  if target_conversation_id is null or not public.is_conversation_member(target_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.message_pins where conversation_id = target_conversation_id and message_id = p_message_id) then
    delete from public.message_pins where conversation_id = target_conversation_id;
  else
    insert into public.message_pins (conversation_id, message_id, pinned_by)
    values (target_conversation_id, p_message_id, auth.uid())
    on conflict (conversation_id) do update set message_id = excluded.message_id, pinned_by = excluded.pinned_by, created_at = now();
  end if;
end;
$$;

create function public.delete_direct_message(p_message_id uuid, p_for_everyone boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_conversation_id uuid; target_sender_id uuid;
begin
  select conversation_id, sender_id into target_conversation_id, target_sender_id from public.messages where id = p_message_id;
  if target_conversation_id is null or not public.is_conversation_member(target_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_for_everyone then
    if target_sender_id <> auth.uid() then raise exception 'Only sender may delete for everyone' using errcode = '42501'; end if;
    delete from public.messages where id = p_message_id;
  else
    insert into public.message_hidden_for (message_id, user_id) values (p_message_id, auth.uid()) on conflict do nothing;
  end if;
end;
$$;

create function public.send_direct_message(p_conversation_id uuid, p_body text)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  image_path text,
  image_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_body text := trim(p_body);
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if char_length(clean_body) not between 1 and 4000 then
    raise exception 'Message must contain from 1 to 4000 characters' using errcode = '22023';
  end if;

  return query
  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, auth.uid(), clean_body)
  returning messages.id, messages.sender_id, messages.body, messages.created_at, messages.read_at, messages.image_path, messages.image_name;
end;
$$;

create function public.send_image_message(p_conversation_id uuid, p_image_path text, p_image_name text)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  image_path text,
  image_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_image_path !~ ('^' || p_conversation_id::text || '/' || auth.uid()::text || '/') then
    raise exception 'Invalid image path' using errcode = '22023';
  end if;

  return query
  insert into public.messages (conversation_id, sender_id, body, image_path, image_name)
  values (p_conversation_id, auth.uid(), 'Фото', p_image_path, left(trim(p_image_name), 180))
  returning messages.id, messages.sender_id, messages.body, messages.created_at, messages.read_at, messages.image_path, messages.image_name;
end;
$$;

create or replace function public.mark_direct_messages_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  update public.messages
  set read_at = now()
  where conversation_id = p_conversation_id
    and sender_id <> auth.uid()
    and read_at is null;
end;
$$;

drop policy if exists "profile visible to authenticated" on public.profiles;
drop policy if exists "profile owner can read" on public.profiles;
create policy "profile owner can read" on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "members can read conversations" on public.conversations;
create policy "members can read conversations" on public.conversations for select to authenticated using (public.is_conversation_member(id));

drop policy if exists "members can read messages" on public.messages;
create policy "members can read messages" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "members can send messages" on public.messages;
create policy "members can send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

revoke all on function public.is_conversation_member(uuid) from public;
revoke all on function public.search_users(text) from public;
revoke all on function public.get_or_create_direct_conversation(uuid) from public;
revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.admin_set_badge(uuid, text) from public;
revoke all on function public.admin_set_ban(uuid, boolean, text) from public;
revoke all on function public.admin_grant_osi(uuid, bigint) from public;
revoke all on function public.list_direct_conversations() from public;
revoke all on function public.list_messages(uuid) from public;
revoke all on function public.send_direct_message(uuid, text) from public;
revoke all on function public.send_image_message(uuid, text, text) from public;
revoke all on function public.mark_direct_messages_read(uuid) from public;
revoke all on function public.get_pinned_message(uuid) from public;
revoke all on function public.toggle_direct_message_pin(uuid) from public;
revoke all on function public.delete_direct_message(uuid, boolean) from public;

grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.search_users(text) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.get_public_profile(uuid) to authenticated;
grant execute on function public.admin_set_badge(uuid, text) to authenticated;
grant execute on function public.admin_set_ban(uuid, boolean, text) to authenticated;
grant execute on function public.admin_grant_osi(uuid, bigint) to authenticated;
grant execute on function public.list_direct_conversations() to authenticated;
grant execute on function public.list_messages(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.send_image_message(uuid, text, text) to authenticated;
grant execute on function public.mark_direct_messages_read(uuid) to authenticated;
grant execute on function public.get_pinned_message(uuid) to authenticated;
grant execute on function public.toggle_direct_message_pin(uuid) to authenticated;
grant execute on function public.delete_direct_message(uuid, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat members can view media" on storage.objects;
create policy "chat members can view media" on storage.objects for select to authenticated using (
  bucket_id = 'chat-media'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "chat members can upload media" on storage.objects;
create policy "chat members can upload media" on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-media'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "chat members can delete own media" on storage.objects;
create policy "chat members can delete own media" on storage.objects for delete to authenticated using (
  bucket_id = 'chat-media'
  and public.is_conversation_member((storage.foldername(name))[1]::uuid)
  and (storage.foldername(name))[2] = auth.uid()::text
);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;
