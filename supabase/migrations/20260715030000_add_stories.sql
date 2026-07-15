-- Ephemeral stories. Expired records are never returned to clients.
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image', 'video', 'gif')),
  overlay_text text check (char_length(overlay_text) <= 80),
  description text check (char_length(description) <= 180),
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16', '1:1', '16:9')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists stories_active_by_user_idx on public.stories (user_id, expires_at desc);

alter table public.stories enable row level security;
create policy "story owner creates stories" on public.stories for insert to authenticated with check (user_id = auth.uid());
create policy "story owner deletes stories" on public.stories for delete to authenticated using (user_id = auth.uid());
create policy "stories visible to direct contacts" on public.stories for select to authenticated using (
  expires_at > now() and (
    user_id = auth.uid() or exists (
      select 1 from public.conversations c
      join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
      join public.conversation_members author on author.conversation_id = c.id and author.user_id = stories.user_id
      where c.is_group = false
        and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
    )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

create policy "story owners upload media" on storage.objects for insert to authenticated with check (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "story owners delete media" on storage.objects for delete to authenticated using (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "story contacts read media" on storage.objects for select to authenticated using (
  bucket_id = 'stories' and exists (
    select 1 from public.stories s
    where s.media_path = name and s.expires_at > now() and (
      s.user_id = auth.uid() or exists (
        select 1 from public.conversations c
        join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
        join public.conversation_members author on author.conversation_id = c.id and author.user_id = s.user_id
        where c.is_group = false
          and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
      )
    )
  )
);

create function public.list_contact_stories()
returns table (
  story_id uuid, user_id uuid, username text, display_name text, avatar_color text, avatar_path text,
  media_path text, media_type text, overlay_text text, description text, aspect_ratio text,
  created_at timestamptz, expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  return query
  select s.id, p.id, p.username, p.display_name, p.avatar_color, p.avatar_path,
    s.media_path, s.media_type, s.overlay_text, s.description, s.aspect_ratio, s.created_at, s.expires_at
  from public.stories s
  join public.profiles p on p.id = s.user_id
  where s.expires_at > now() and (
    s.user_id = auth.uid() or exists (
      select 1 from public.conversations c
      join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
      join public.conversation_members author on author.conversation_id = c.id and author.user_id = s.user_id
      where c.is_group = false
        and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
    )
  )
  order by s.created_at desc;
end;
$$;

revoke all on function public.list_contact_stories() from public;
grant execute on function public.list_contact_stories() to authenticated;
