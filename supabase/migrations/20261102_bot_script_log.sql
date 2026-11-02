-- 📜 봇 스크립트 적용 기록. !봇적용 · !봇되돌리기 가 끝나면 봇이 파일마다 한 줄씩 남긴다 (diff 는 키를 가린 내용)
-- 읽기 · 쓰기는 사이트 API(관리자 확인)와 봇만. 여러 번 실행해도 된다.
create table if not exists public.bot_script_log (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  action      text not null check (action in ('edit', 'add', 'delete', 'revert')),
  diff        text not null default '',
  plus        int not null default 0,
  minus       int not null default 0,
  edited_by   text,
  applied_by  text,
  applied_at  timestamptz not null default now()
);
create index if not exists bot_script_log_time_idx on public.bot_script_log (applied_at desc);
create index if not exists bot_script_log_name_idx on public.bot_script_log (name, applied_at desc);
alter table public.bot_script_log enable row level security;   -- 정책 없음: 서버 · 봇만
