drop function if exists public.list_story_viewers(uuid);

create function public.list_story_viewers(p_story_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_color text,
  avatar_path text,
  reaction text,
  viewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.stories as story
    where story.id = p_story_id
      and story.user_id = auth.uid()
  ) then
    raise exception 'Only the author can view this list' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.username,
    profile.display_name,
    profile.avatar_color,
    profile.avatar_path,
    story_view.reaction,
    story_view.viewed_at
  from public.story_views as story_view
  join public.profiles as profile on profile.id = story_view.viewer_id
  where story_view.story_id = p_story_id
  order by story_view.viewed_at desc;
end;
$$;

revoke all on function public.list_story_viewers(uuid) from public;
grant execute on function public.list_story_viewers(uuid) to authenticated;
