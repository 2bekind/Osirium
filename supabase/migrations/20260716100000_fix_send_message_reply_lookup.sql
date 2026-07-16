create or replace function public.send_direct_message(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_forwarded_from_id uuid default null
)
returns table (
  id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz,
  image_path text, image_name text, audio_path text, audio_name text, audio_duration integer,
  reply_to_id uuid, reply_body text, reply_sender_id uuid, forwarded_from_id uuid, edited_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  clean_body text := left(trim(p_body), 500);
  created_message public.messages;
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if char_length(clean_body) not between 1 and 500 then
    raise exception 'Invalid message' using errcode = '22023';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1
    from public.messages message_to_reply
    where message_to_reply.id = p_reply_to_id
      and message_to_reply.conversation_id = p_conversation_id
  ) then
    raise exception 'Invalid reply' using errcode = '22023';
  end if;

  insert into public.messages (conversation_id, sender_id, body, reply_to_id, forwarded_from_id)
  values (p_conversation_id, auth.uid(), clean_body, p_reply_to_id, p_forwarded_from_id)
  returning * into created_message;

  return query
  select
    created_message.id, created_message.sender_id, created_message.body, created_message.created_at, created_message.read_at,
    created_message.image_path, created_message.image_name, created_message.audio_path, created_message.audio_name, created_message.audio_duration,
    created_message.reply_to_id, replied.body, replied.sender_id, created_message.forwarded_from_id, created_message.edited_at
  from public.messages replied
  where replied.id = created_message.reply_to_id
  union all
  select
    created_message.id, created_message.sender_id, created_message.body, created_message.created_at, created_message.read_at,
    created_message.image_path, created_message.image_name, created_message.audio_path, created_message.audio_name, created_message.audio_duration,
    created_message.reply_to_id, null, null, created_message.forwarded_from_id, created_message.edited_at
  where created_message.reply_to_id is null;
end;
$$;

grant execute on function public.send_direct_message(uuid, text, uuid, uuid) to authenticated;
