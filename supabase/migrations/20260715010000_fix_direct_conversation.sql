-- Fix direct-message creation: the previous version referenced a missing table alias.
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
  if exists (select 1 from public.profiles where id = other_user_id and is_banned) then
    raise exception 'User is banned' using errcode = '42501';
  end if;

  select c.id into direct_conversation_id
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = current_user_id
  join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id = other_user_id
  where c.is_group = false
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

grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
