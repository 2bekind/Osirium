alter table public.messages add column if not exists audio_path text;
alter table public.messages add column if not exists audio_name text;
alter table public.messages add column if not exists audio_duration integer check (audio_duration between 1 and 3600);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/webm', 'audio/ogg'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop function if exists public.list_messages(uuid);
drop function if exists public.get_pinned_message(uuid);
drop function if exists public.send_direct_message(uuid, text);
drop function if exists public.send_image_message(uuid, text, text);

create function public.list_messages(p_conversation_id uuid)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz, image_path text, image_name text, audio_path text, audio_name text, audio_duration integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name, m.audio_path, m.audio_name, m.audio_duration
  from public.messages m where m.conversation_id = p_conversation_id
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
  order by m.created_at asc;
end;
$$;

create function public.get_pinned_message(p_conversation_id uuid)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz, image_path text, image_name text, audio_path text, audio_name text, audio_duration integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query select m.id, m.sender_id, m.body, m.created_at, m.read_at, m.image_path, m.image_name, m.audio_path, m.audio_name, m.audio_duration
  from public.message_pins pin join public.messages m on m.id = pin.message_id
  where pin.conversation_id = p_conversation_id
    and not exists (select 1 from public.message_hidden_for hidden where hidden.message_id = m.id and hidden.user_id = auth.uid())
  limit 1;
end;
$$;

create function public.send_direct_message(p_conversation_id uuid, p_body text)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz, image_path text, image_name text, audio_path text, audio_name text, audio_duration integer)
language plpgsql security definer set search_path = public as $$
declare clean_body text := trim(p_body);
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if char_length(clean_body) not between 1 and 4000 then raise exception 'Message must contain from 1 to 4000 characters' using errcode = '22023'; end if;
  return query insert into public.messages (conversation_id, sender_id, body) values (p_conversation_id, auth.uid(), clean_body)
  returning messages.id, messages.sender_id, messages.body, messages.created_at, messages.read_at, messages.image_path, messages.image_name, messages.audio_path, messages.audio_name, messages.audio_duration;
end;
$$;

create function public.send_image_message(p_conversation_id uuid, p_image_path text, p_image_name text)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz, image_path text, image_name text, audio_path text, audio_name text, audio_duration integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_image_path !~ ('^' || p_conversation_id::text || '/' || auth.uid()::text || '/') then raise exception 'Invalid image path' using errcode = '22023'; end if;
  return query insert into public.messages (conversation_id, sender_id, body, image_path, image_name) values (p_conversation_id, auth.uid(), 'Фото', p_image_path, left(trim(p_image_name), 180))
  returning messages.id, messages.sender_id, messages.body, messages.created_at, messages.read_at, messages.image_path, messages.image_name, messages.audio_path, messages.audio_name, messages.audio_duration;
end;
$$;

create function public.send_voice_message(p_conversation_id uuid, p_audio_path text, p_audio_name text, p_audio_duration integer)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz, image_path text, image_name text, audio_path text, audio_name text, audio_duration integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_audio_path !~ ('^' || p_conversation_id::text || '/' || auth.uid()::text || '/') then raise exception 'Invalid audio path' using errcode = '22023'; end if;
  if p_audio_duration not between 1 and 3600 then raise exception 'Invalid audio duration' using errcode = '22023'; end if;
  return query insert into public.messages (conversation_id, sender_id, body, audio_path, audio_name, audio_duration)
  values (p_conversation_id, auth.uid(), 'Голосовое сообщение', p_audio_path, left(trim(p_audio_name), 180), p_audio_duration)
  returning messages.id, messages.sender_id, messages.body, messages.created_at, messages.read_at, messages.image_path, messages.image_name, messages.audio_path, messages.audio_name, messages.audio_duration;
end;
$$;

revoke all on function public.send_voice_message(uuid, text, text, integer) from public;
grant execute on function public.list_messages(uuid) to authenticated;
grant execute on function public.get_pinned_message(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.send_image_message(uuid, text, text) to authenticated;
grant execute on function public.send_voice_message(uuid, text, text, integer) to authenticated;
