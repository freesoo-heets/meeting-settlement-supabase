create extension if not exists pgcrypto;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists members_name_unique
on public.members (lower(name));

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  cost numeric(12, 0) not null default 0 check (cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(meeting_id, member_id)
);

alter table public.members enable row level security;
alter table public.meetings enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "public members all" on public.members;
create policy "public members all"
on public.members
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public meetings all" on public.meetings;
create policy "public meetings all"
on public.meetings
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public attendance all" on public.attendance;
create policy "public attendance all"
on public.attendance
for all
to anon, authenticated
using (true)
with check (true);
