-- Step 13: 선입금을 "월별"이 아니라 "해당 모임별"로 저장합니다.

create table if not exists public.meeting_prepayments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount numeric(12, 0) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(meeting_id, member_id)
);

create index if not exists meeting_prepayments_meeting_id_idx
on public.meeting_prepayments(meeting_id);

alter table public.meeting_prepayments enable row level security;

drop policy if exists "public meeting prepayments all"
on public.meeting_prepayments;

create policy "public meeting prepayments all"
on public.meeting_prepayments
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete
on table public.meeting_prepayments
to anon, authenticated;

-- 기존 monthly_prepayments 테이블은 더 이상 화면에서 사용하지 않습니다.
-- 과거 데이터 보존을 위해 자동 삭제하지 않습니다.
