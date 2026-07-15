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
  if not exists (
    select 1 from public.stories as s
    where s.id = p_story_id and s.user_id = auth.uid()
  ) then
    raise exception 'Only the author can view this list' using errcode = '42501';
  end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, v.reaction, v.viewed_at
  from public.story_views as v
  join public.profiles as p on p.id = v.viewer_id
  where v.story_id = p_story_id
  order by v.viewed_at desc;
end;
$$;

grant execute on function public.list_story_viewers(uuid) to authenticated;
