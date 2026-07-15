-- A single private interaction record per viewer and story.
create table public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  reaction text check (reaction in ('heart') or reaction is null),
  viewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

alter table public.story_views enable row level security;

create or replace function public.record_story_view(p_story_id uuid, p_reaction text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  author uuid;
begin
  if viewer is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select user_id into author from public.stories where id = p_story_id and expires_at > now();
  if author is null then raise exception 'Story not found' using errcode = 'P0002'; end if;
  if author <> viewer and not exists (
    select 1 from public.conversations c
    join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = viewer
    join public.conversation_members author_member on author_member.conversation_id = c.id and author_member.user_id = author
    where c.is_group = false and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  ) then raise exception 'Story is unavailable' using errcode = '42501'; end if;

  insert into public.story_views (story_id, viewer_id, reaction)
  values (p_story_id, viewer, p_reaction)
  on conflict (story_id, viewer_id) do update set
    reaction = excluded.reaction,
    updated_at = now();
end;
$$;

create or replace function public.list_story_viewers(p_story_id uuid)
returns table (
  user_id uuid, username text, display_name text, avatar_color text, avatar_path text,
  reaction text, viewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.stories where id = p_story_id and user_id = auth.uid()) then
    raise exception 'Only the author can view this list' using errcode = '42501';
  end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, v.reaction, v.viewed_at
  from public.story_views v join public.profiles p on p.id = v.viewer_id
  where v.story_id = p_story_id
  order by v.viewed_at desc;
end;
$$;

create or replace function public.reply_to_story(p_story_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid := auth.uid();
  author uuid;
  conversation uuid;
  message_id uuid;
begin
  if sender is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if char_length(trim(p_body)) not between 1 and 500 then raise exception 'Invalid message' using errcode = '22023'; end if;
  select user_id into author from public.stories where id = p_story_id and expires_at > now();
  if author is null or author = sender then raise exception 'Story is unavailable' using errcode = '42501'; end if;
  select c.id into conversation
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = sender
  join public.conversation_members author_member on author_member.conversation_id = c.id and author_member.user_id = author
  where c.is_group = false and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  limit 1;
  if conversation is null then raise exception 'Conversation not found' using errcode = '42501'; end if;
  insert into public.messages (conversation_id, sender_id, body)
  values (conversation, sender, concat('Ответ на историю: ', trim(p_body)))
  returning id into message_id;
  return message_id;
end;
$$;

revoke all on function public.record_story_view(uuid, text) from public;
revoke all on function public.list_story_viewers(uuid) from public;
revoke all on function public.reply_to_story(uuid, text) from public;
grant execute on function public.record_story_view(uuid, text) to authenticated;
grant execute on function public.list_story_viewers(uuid) to authenticated;
grant execute on function public.reply_to_story(uuid, text) to authenticated;
