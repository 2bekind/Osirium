drop function if exists public.record_story_view(uuid, text);

create function public.record_story_view(p_story_id uuid, p_reaction text default null, p_clear_reaction boolean default false)
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
  select story.user_id into author from public.stories as story where story.id = p_story_id and story.expires_at > now();
  if author is null then raise exception 'Story not found' using errcode = 'P0002'; end if;
  if author <> viewer and not exists (
    select 1 from public.conversations as conversation
    join public.conversation_members as mine on mine.conversation_id = conversation.id and mine.user_id = viewer
    join public.conversation_members as author_member on author_member.conversation_id = conversation.id and author_member.user_id = author
    where conversation.is_group = false
      and (select count(*) from public.conversation_members as member where member.conversation_id = conversation.id) = 2
  ) then raise exception 'Story is unavailable' using errcode = '42501'; end if;

  insert into public.story_views (story_id, viewer_id, reaction)
  values (p_story_id, viewer, p_reaction)
  on conflict (story_id, viewer_id) do update set
    reaction = case when p_clear_reaction then null else coalesce(excluded.reaction, public.story_views.reaction) end,
    updated_at = now();
end;
$$;

revoke all on function public.record_story_view(uuid, text, boolean) from public;
grant execute on function public.record_story_view(uuid, text, boolean) to authenticated;
