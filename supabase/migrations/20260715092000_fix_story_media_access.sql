create or replace function public.can_read_story_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.stories as story
    where story.media_path = p_name
      and story.expires_at > now()
      and (
        story.user_id = auth.uid()
        or exists (
          select 1
          from public.conversations as conversation
          join public.conversation_members as mine on mine.conversation_id = conversation.id and mine.user_id = auth.uid()
          join public.conversation_members as author on author.conversation_id = conversation.id and author.user_id = story.user_id
          where conversation.is_group = false
            and (select count(*) from public.conversation_members as member where member.conversation_id = conversation.id) = 2
        )
      )
  );
$$;

drop policy if exists "story contacts read media" on storage.objects;
create policy "story contacts read media" on storage.objects for select to authenticated using (
  bucket_id = 'stories' and public.can_read_story_media(name)
);

revoke all on function public.can_read_story_media(text) from public;
grant execute on function public.can_read_story_media(text) to authenticated;
