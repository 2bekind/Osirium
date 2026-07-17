create or replace function public.list_my_story_archive()
returns table (
  story_id uuid, user_id uuid, username text, display_name text, avatar_color text, avatar_path text,
  media_path text, media_type text, overlay_text text, description text, aspect_ratio text,
  created_at timestamptz, expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, p.id, p.username, p.display_name, p.avatar_color, p.avatar_path,
    s.media_path, s.media_type, s.overlay_text, s.description, s.aspect_ratio, s.created_at, s.expires_at
  from public.stories s
  join public.profiles p on p.id = s.user_id
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;

create or replace function public.can_read_story_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stories s
    where s.media_path = p_name
      and (
        s.user_id = auth.uid()
        or (
          s.expires_at > now()
          and exists (
            select 1
            from public.conversations c
            join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
            join public.conversation_members author on author.conversation_id = c.id and author.user_id = s.user_id
            where c.is_group = false
              and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
          )
        )
      )
  );
$$;

revoke all on function public.list_my_story_archive() from public;
grant execute on function public.list_my_story_archive() to authenticated;
revoke all on function public.can_read_story_media(text) from public;
grant execute on function public.can_read_story_media(text) to authenticated;
