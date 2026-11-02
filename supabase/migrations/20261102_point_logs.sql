-- 📜 점수 내역 누적. 폰(point_log.json)은 사람당 100건만 남기므로 사이트에 쌓아 두고 100건씩 페이지로 본다
-- 봇이 새 항목만 넣고(key 로 중복 방지), 로그인한 회원이 읽는다
create table if not exists public.bot_point_logs (
  id          bigint generated always as identity primary key,
  key         text not null unique,
  uid         text not null,
  t           text not null,
  amt         integer not null,
  after_exp   integer not null,
  why         text not null default '',
  actor       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists bot_point_logs_page_idx on public.bot_point_logs (uid, t desc, id desc);
alter table public.bot_point_logs enable row level security;
drop policy if exists bot_point_logs_select on public.bot_point_logs;
create policy bot_point_logs_select on public.bot_point_logs
  for select to authenticated using (public.can_use_app());
