-- 🕒 봇 파일 정보. 봇이 파일을 확인할 때마다 맞춘다
--   file_at  = 폰에 있는 파일의 마지막 수정 시각
--   conflict = 사이트 초안을 만든 뒤 파일이 직접 수정됨 (그대로 적용하면 직접 고친 내용이 사라져서 적용을 막는다)
-- 읽기 · 쓰기는 사이트 API(관리자 확인)와 봇만. 여러 번 실행해도 된다.
create table if not exists public.bot_script_meta (
  name      text primary key,
  file_at   timestamptz,
  conflict  boolean not null default false
);
alter table public.bot_script_meta enable row level security;   -- 정책 없음: 서버 · 봇만
