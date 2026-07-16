create or replace function public.search_users(search_text text)
returns table (id uuid, username text, display_name text, avatar_color text, avatar_path text, is_admin boolean, badge text, is_banned boolean, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  query_text text := lower(trim(search_text));
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if char_length(query_text) < 3 then return; end if;

  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge, p.is_banned, p.last_seen_at
  from public.profiles p
  where p.id <> auth.uid()
    and (p.is_banned = false or exists (select 1 from public.profiles admin_profile where admin_profile.id = auth.uid() and admin_profile.public_id = 1))
    and p.username = query_text
  limit 1;
end;
$$;

grant execute on function public.search_users(text) to authenticated;
