-- 📜 사람별 점수 내역(!점수내역 과 같은 내용) · 메달. 봇이 바뀐 사람만 올리고, 로그인한 회원이 읽는다
create table if not exists public.bot_point_details (
  uid         text primary key,
  logs        jsonb not null default '[]'::jsonb,
  medals      text not null default '',
  sig         text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.bot_point_details enable row level security;
drop policy if exists bot_point_details_select on public.bot_point_details;
create policy bot_point_details_select on public.bot_point_details
  for select to authenticated using (public.can_use_app());

-- ⚙️ 메달 추가 · 삭제 요청
alter table public.point_adjustments add column if not exists medal_add text;
alter table public.point_adjustments add column if not exists medal_remove text;
alter table public.point_adjustments add column if not exists medals_after text;
alter table public.point_adjustments add column if not exists trophies_after text;
alter table public.point_adjustments drop constraint if exists point_adjustments_check;
alter table public.point_adjustments add constraint point_adjustments_check
  check (points <> 0 or tickets <> 0 or medal_add is not null or medal_remove is not null);
