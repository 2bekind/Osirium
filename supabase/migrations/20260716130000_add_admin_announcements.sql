create table if not exists public.admin_announcements (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.admin_announcements enable row level security;

create or replace function public.create_admin_announcement(p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then
    raise exception 'Only administrator can create announcements' using errcode = '42501';
  end if;
  if char_length(trim(p_body)) not between 1 and 500 then
    raise exception 'Announcement must contain 1 to 500 characters' using errcode = '22023';
  end if;
  insert into public.admin_announcements (body) values (trim(p_body)) returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.get_latest_admin_announcement()
returns table (id uuid, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select announcement.id, announcement.body, announcement.created_at
  from public.admin_announcements as announcement
  order by announcement.created_at desc
  limit 1;
$$;

revoke all on function public.create_admin_announcement(text) from public;
revoke all on function public.get_latest_admin_announcement() from public;
grant execute on function public.create_admin_announcement(text) to authenticated;
grant execute on function public.get_latest_admin_announcement() to authenticated;
