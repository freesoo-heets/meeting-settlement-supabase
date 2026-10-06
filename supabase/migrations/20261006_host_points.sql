-- 벙주 포인트(벙포): 벙주 · 시작 시각 · 온라인 참석 · 지급 기록

-- 벙주 (기본: 카톡 일정을 처음 올린 사람, 사이트에서 변경 가능)
alter table public.meetings add column if not exists host_member uuid references public.members(id) on delete set null;
alter table public.meetings add column if not exists host_uid text;          -- 카톡 일정 작성자 user_id
alter table public.meetings add column if not exists starts_at timestamptz;  -- 카톡 일정 시작 시각 (N차 '하루' 판정용)

-- 온라인 참석 (게임 등) → 벙포 50%
alter table public.attendance add column if not exists online boolean not null default false;

-- 벙포 지급 기록 (중복 지급 방지)
create table if not exists public.host_point_payouts (
  id          uuid primary key default gen_random_uuid(),
  biz_date    date not null,               -- 오전 10시 ~ 다음날 오전 10시 를 하루로 본 날짜
  host_member uuid,
  host_name   text not null,
  host_uid    text,
  amount      integer not null,
  detail      text,
  paid_by     text,
  created_at  timestamptz not null default now()
);
create index if not exists host_point_payouts_date_idx on public.host_point_payouts (biz_date);
alter table public.host_point_payouts enable row level security;
drop policy if exists host_point_payouts_select on public.host_point_payouts;
create policy host_point_payouts_select on public.host_point_payouts
  for select to authenticated using (public.can_use_app());
