-- Step 10: 게스트 + 월별 선입금

create table if not exists public.meeting_guests (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  name text not null,
  fixed_amount numeric(12, 0) check (fixed_amount is null or fixed_amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists meeting_guests_meeting_id_idx
on public.meeting_guests(meeting_id);

alter table public.meeting_guests enable row level security;

drop policy if exists "public meeting guests all"
on public.meeting_guests;

create policy "public meeting guests all"
on public.meeting_guests
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete
on table public.meeting_guests
to anon, authenticated;


create table if not exists public.monthly_prepayments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  settlement_month text not null,
  amount numeric(12, 0) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, settlement_month)
);

alter table public.monthly_prepayments enable row level security;

drop policy if exists "public monthly prepayments all"
on public.monthly_prepayments;

create policy "public monthly prepayments all"
on public.monthly_prepayments
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete
on table public.monthly_prepayments
to anon, authenticated;
