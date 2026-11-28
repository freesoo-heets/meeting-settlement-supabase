-- DRAFT ONLY: do not run on production before isolated DB tests.
-- All access is server-side via service role. No anon/authenticated policies.
create extension if not exists pgcrypto;

create table if not exists public.horse_race_rooms (
  id uuid primary key default gen_random_uuid(),
  host_member uuid not null references public.members(id),
  status text not null default 'waiting'
    check (status in ('waiting','countdown','running','finished','cancelled')),
  mode text not null default 'friendly'
    check (mode in ('friendly','free_prediction')),
  starts_at timestamptz,
  locked_at timestamptz,
  finished_at timestamptz,
  winning_horse smallint check (winning_horse between 1 and 6),
  results jsonb,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.horse_race_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.horse_race_rooms(id) on delete cascade,
  member_id uuid not null references public.members(id),
  horse_no smallint check (horse_no between 1 and 6),
  joined_at timestamptz not null default now(),
  picked_at timestamptz,
  unique(room_id, member_id)
);

-- Never fetch this table from browser; only the privileged API may read it.
create table if not exists public.horse_race_secrets (
  room_id uuid primary key references public.horse_race_rooms(id) on delete cascade,
  seed text not null check (seed ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz not null default now()
);

-- The bot may later process reward rows using a dedicated idempotent worker.
create table if not exists public.horse_race_rewards (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.horse_race_rooms(id),
  member_id uuid not null references public.members(id),
  horse_no smallint not null check (horse_no between 1 and 6),
  rank smallint not null check (rank between 1 and 6),
  amount integer not null check (amount between 0 and 100),
  status text not null default 'pending'
    check (status in ('pending','processing','paid','failed','cancelled')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(room_id, member_id)
);

create index if not exists horse_race_rooms_open_idx
  on public.horse_race_rooms(status, created_at desc);
create index if not exists horse_race_entries_member_idx
  on public.horse_race_entries(member_id, joined_at desc);
create index if not exists horse_race_rewards_status_idx
  on public.horse_race_rewards(status, created_at);

alter table public.horse_race_rooms enable row level security;
alter table public.horse_race_entries enable row level security;
alter table public.horse_race_secrets enable row level security;
alter table public.horse_race_rewards enable row level security;

revoke all on public.horse_race_rooms from anon, authenticated;
revoke all on public.horse_race_entries from anon, authenticated;
revoke all on public.horse_race_secrets from anon, authenticated;
revoke all on public.horse_race_rewards from anon, authenticated;
