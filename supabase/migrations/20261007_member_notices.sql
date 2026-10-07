-- 참석 경고 안내 (월별 참석 현황 → 관리자 '알림' 버튼 → 봇이 카톡방에 멘션으로 올리고 sent_at 기록)
create table if not exists public.member_notices (
  id           uuid primary key default gen_random_uuid(),
  member_ids   jsonb not null default '[]'::jsonb,
  requested_by uuid,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  result       text
);
create index if not exists member_notices_pending_idx on public.member_notices (created_at) where sent_at is null;
alter table public.member_notices enable row level security;
-- 정책 없음: 서버 API·봇(service_role)만 읽고 쓴다
