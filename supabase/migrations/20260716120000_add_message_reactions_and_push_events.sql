create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('heart')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

create or replace function public.toggle_message_reaction(p_message_id uuid, p_reaction text default 'heart')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  conversation uuid;
  removed boolean := false;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_reaction <> 'heart' then raise exception 'Invalid reaction' using errcode = '22023'; end if;
  select m.conversation_id into conversation from public.messages as m where m.id = p_message_id;
  if conversation is null or not exists (
    select 1 from public.conversation_members as member
    where member.conversation_id = conversation and member.user_id = actor
  ) then raise exception 'Message unavailable' using errcode = '42501'; end if;
  if exists (select 1 from public.message_reactions where message_id = p_message_id and user_id = actor) then
    delete from public.message_reactions where message_id = p_message_id and user_id = actor;
    removed := true;
  else
    insert into public.message_reactions (message_id, user_id, reaction) values (p_message_id, actor, p_reaction);
  end if;
  return not removed;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;
