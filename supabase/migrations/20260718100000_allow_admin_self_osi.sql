create or replace function public.search_users(search_text text)
returns table (id uuid, username text, display_name text, avatar_color text, avatar_path text, is_admin boolean, badge text, is_banned boolean, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  query_text text := lower(trim(search_text));
  is_admin boolean := exists (select 1 from public.profiles where id = auth.uid() and public_id = 1);
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if char_length(query_text) < 3 then return; end if;

  return query
  select p.id, p.username, p.display_name, p.avatar_color, p.avatar_path, p.public_id = 1, p.badge, p.is_banned, p.last_seen_at
  from public.profiles p
  where (p.id <> auth.uid() or is_admin)
    and (p.is_banned = false or is_admin)
    and p.username = query_text
  limit 1;
end;
$$;

create or replace function public.admin_grant_osi(p_user_id uuid, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_balance bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and public_id = 1) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;

  update public.profiles
  set osi_balance = osi_balance + p_amount
  where id = p_user_id
  returning osi_balance into next_balance;

  if next_balance is null then raise exception 'User not found' using errcode = '22023'; end if;

  insert into public.admin_audit_log (actor_id, target_user_id, action, previous_state, next_state)
  values (auth.uid(), p_user_id, 'osi', jsonb_build_object('delta', p_amount), jsonb_build_object('balance', next_balance));

  return next_balance;
end;
$$;
