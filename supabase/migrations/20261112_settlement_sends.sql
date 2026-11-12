-- 🤖 정산 글 봇 전송 요청 (사이트 '카카오톡 공유하기' 버튼 → 봇이 몇 초 안에 본방에 태그와 함께 올린다)
--   meeting_ids: 한 벙이면 1개, 통합 정산이면 여러 개
--   봇이 가져가면 sent_at 을 적고, 다 보내면 result 에 결과 문구 (✅ … / ⚠️ …)
-- 읽기 · 쓰기는 사이트 API(서비스 키)와 봇만. 여러 번 실행해도 된다.
create table if not exists public.settlement_sends (
  id              uuid primary key default gen_random_uuid(),
  meeting_ids     jsonb not null default '[]'::jsonb,
  requested_by    uuid references public.members(id),
  requested_name  text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  result          text
);
create index if not exists settlement_sends_pending_idx on public.settlement_sends (created_at) where sent_at is null;
alter table public.settlement_sends enable row level security;   -- 정책 없음: 서버 · 봇만
