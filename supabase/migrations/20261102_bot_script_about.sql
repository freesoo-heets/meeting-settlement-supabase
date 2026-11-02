-- 📝 봇관리에서 관리자가 적은 파일 설명. 없으면 사이트 기본 설명(lib/botScriptInfo.ts)을 보여 준다
-- 봇이 파일을 다시 올려도 지워지지 않게 bot_scripts 와 따로 둔다. 읽기 · 쓰기는 사이트 API(관리자 확인)만. 여러 번 실행해도 된다.
create table if not exists public.bot_script_about (
  name        text primary key,
  about       text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table public.bot_script_about enable row level security;   -- 정책 없음: 서버만
