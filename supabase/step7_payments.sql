-- Step 7: 월별 실제 정산 상태 저장
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  settlement_month text not null,
  amount numeric(12, 0) not null default 0 check (amount >= 0),
  paid boolean not null default false,
  paid_at date,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, settlement_month)
);

alter table public.payments enable row level security;

drop policy if exists "public payments all" on public.payments;

create policy "public payments all"
on public.payments
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete
on table public.payments
to anon, authenticated;
