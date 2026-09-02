-- Step 9: 모임별 특정인원 금액 지정
-- 기본 정산은 참석자 1/N.
-- 여기에 등록된 회원은 특정금액으로 고정하고,
-- 남은 비용만 나머지 참석자에게 1/N 배분합니다.

create table if not exists public.settlement_adjustments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount numeric(12, 0) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(meeting_id, member_id)
);

alter table public.settlement_adjustments enable row level security;

drop policy if exists "public settlement adjustments all"
on public.settlement_adjustments;

create policy "public settlement adjustments all"
on public.settlement_adjustments
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete
on table public.settlement_adjustments
to anon, authenticated;
