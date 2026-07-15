-- Run in Supabase SQL Editor before connecting the app.
create sequence public.profile_public_id_seq as bigint start with 1;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id bigint not null unique default nextval('public.profile_public_id_seq'),
  display_name text not null,
  username text unique,
  avatar_color text default '#dfe6f0',
  avatar_path text,
  bio text not null default '' check (char_length(bio) <= 160),
  badge text check (badge in ('helper', 'idea')),
  is_banned boolean not null default false,
  ban_reason text,
  osi_balance bigint not null default 0 check (osi_balance >= 0),
  created_at timestamptz default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  is_group boolean default false,
  created_at timestamptz default now()
);

create table public.conversation_members (
  conversation_id uuid references public.conversations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "profile visible to authenticated" on public.profiles for select to authenticated using (true);
create policy "profile owner can update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "profile owner can create" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "members can read conversations" on public.conversations for select to authenticated using (exists (select 1 from public.conversation_members m where m.conversation_id = id and m.user_id = auth.uid()));
create policy "members can read messages" on public.messages for select to authenticated using (exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid()));
create policy "members can send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid()));
