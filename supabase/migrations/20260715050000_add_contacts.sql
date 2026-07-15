-- Personal contact names are visible only to the account that created them.
create table if not exists public.contacts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 48),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, contact_id),
  check (owner_id <> contact_id)
);

alter table public.contacts enable row level security;

create policy "Contacts are private" on public.contacts
  for select to authenticated using (owner_id = auth.uid());
create policy "Owners create contacts" on public.contacts
  for insert to authenticated with check (owner_id = auth.uid());
create policy "Owners update contacts" on public.contacts
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners delete contacts" on public.contacts
  for delete to authenticated using (owner_id = auth.uid());

create or replace function public.touch_contact_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contacts_touch_updated_at
  before update on public.contacts
  for each row execute function public.touch_contact_updated_at();
