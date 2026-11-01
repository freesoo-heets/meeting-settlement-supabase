-- 🤖 봇 스크립트 관리. 봇이 이 표에 파일을 올리고, 사이트 관리자가 고치면 운영진방 !봇적용 으로 봇에 반영된다
--   content = 사이트에서 고치는 초안 · live = 지금 봇이 쓰는 내용 (없으면 새 파일)
--   API 키는 봇이 가려서 올린다 (__BOT_SECRET_해시__). 읽기 · 쓰기는 사이트 API(관리자 확인)와 봇만
-- 여러 번 실행해도 된다.
create table if not exists public.bot_scripts (
  name        text primary key check (name ~ '^[A-Za-z0-9_-]+\.py$'),
  content     text not null,
  live        text,
  deleted     boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  is_new      boolean generated always as (live is null) stored,
  changed     boolean generated always as (deleted or live is null or content <> live) stored,
  size        int generated always as (octet_length(content)) stored
);
alter table public.bot_scripts enable row level security;   -- 정책 없음: 서버 · 봇만
