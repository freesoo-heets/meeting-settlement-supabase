-- 🃏 홀덤 티켓 = 1시간 이용권
-- 앉을 때 이용권이 없으면 봇이 티켓 1장을 쓰고 1시간짜리 이용권을 만든다. 1시간 안에는 다시 앉아도 티켓이 들지 않는다.
-- 시간이 1분 남으면 사이트가 renew_state='requested' 로 연장을 요청 → 봇이 티켓 1장으로 1시간 연장 (없으면 failed → 그 판 뒤 일어남)
create table if not exists public.holdem_passes (
  member_id   uuid primary key references public.members(id),
  uid         text not null,
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);
alter table public.holdem_passes enable row level security;
drop policy if exists holdem_passes_select on public.holdem_passes;
create policy holdem_passes_select on public.holdem_passes
  for select to authenticated using (public.can_use_app());

alter table public.holdem_seats add column if not exists pass_until timestamptz;   -- 이 자리의 이용권 끝 시각
alter table public.holdem_seats add column if not exists renew_state text not null default 'none';
alter table public.holdem_seats drop constraint if exists holdem_seats_renew_state_check;
alter table public.holdem_seats add constraint holdem_seats_renew_state_check
  check (renew_state in ('none', 'requested', 'locking', 'failed'));
