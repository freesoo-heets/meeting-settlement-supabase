-- ▶️ 사이트 봇관리 버튼 요청 (적용 · 되돌리기 · 다시 올리기). 사이트 API(관리자 확인)가 넣고 봇이 3초마다 처리한다
--   state: requested → running → done · failed (result 에 결과 문구)
-- 읽기 · 쓰기는 사이트 API 와 봇만. 여러 번 실행해도 된다.
create table if not exists public.bot_commands (
  id            uuid primary key default gen_random_uuid(),
  action        text not null check (action in ('apply', 'revert', 'upload')),
  state         text not null default 'requested' check (state in ('requested', 'running', 'done', 'failed')),
  result        text,
  member_id     uuid references public.members(id),
  requested_by  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bot_commands_state_idx on public.bot_commands (state, created_at);
alter table public.bot_commands enable row level security;   -- 정책 없음: 서버 · 봇만
