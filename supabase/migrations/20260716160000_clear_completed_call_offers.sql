create or replace function public.send_call_signal(
  p_call_id uuid,
  p_conversation_id uuid,
  p_recipient_id uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if coalesce(p_kind, '') not in ('offer', 'answer', 'ice', 'hangup', 'decline') then
    raise exception 'Invalid call signal' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' or octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 50000 then
    raise exception 'Invalid call payload' using errcode = '22023';
  end if;

  if p_recipient_id = auth.uid() or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.conversation_members member
    join public.profiles recipient on recipient.id = member.user_id
    where member.conversation_id = p_conversation_id
      and member.user_id = p_recipient_id
      and recipient.is_banned = false
  ) then
    raise exception 'Recipient unavailable' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.direct_conversation_preferences preference
    where preference.conversation_id = p_conversation_id
      and preference.user_id = p_recipient_id
      and preference.blocked_at is not null
  ) then
    raise exception 'Recipient unavailable' using errcode = '42501';
  end if;

  if p_kind in ('hangup', 'decline') then
    delete from public.call_signals
    where call_id = p_call_id
      and kind in ('offer', 'answer', 'ice');
  end if;

  insert into public.call_signals (call_id, conversation_id, sender_id, recipient_id, kind, payload)
  values (p_call_id, p_conversation_id, auth.uid(), p_recipient_id, p_kind, coalesce(p_payload, '{}'::jsonb));
end;
$$;

revoke all on function public.send_call_signal(uuid, uuid, uuid, text, jsonb) from public;
grant execute on function public.send_call_signal(uuid, uuid, uuid, text, jsonb) to authenticated;
