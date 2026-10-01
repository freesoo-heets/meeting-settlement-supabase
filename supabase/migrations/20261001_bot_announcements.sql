-- 카톡방 초대 메시지 요청 (사이트 '초대 메시지 보내기' → 봇이 올리고 sent_at 기록)
create table if not exists public.bot_announcements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('omok', 'alkkagi')),
  ref_id       uuid not null,
  requested_by uuid,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists bot_announcements_pending_idx on public.bot_announcements (created_at) where sent_at is null;
alter table public.bot_announcements enable row level security;
-- 정책 없음: 서버 API·봇(service_role)만 읽고 쓴다
