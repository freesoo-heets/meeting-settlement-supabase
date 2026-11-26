-- 🃏 홀덤 족보 보너스 (2026-11-26 사용자 요청)
--   높은 족보로 판을 이기면 카톡 점수판에 보너스 점수
--   로얄 스트레이트 플러시 1000 · 스트레이트 플러시 700 · 포카드 500
-- 흐름: 판이 끝나면 사이트 서버가 한 줄 적는다(pending) → 봇이 점수 지급 + 카톡방 알림(paid)
-- 화면은 읽지 않는다 (서버 API · 봇만 쓴다). 여러 번 실행해도 된다.

create table if not exists public.holdem_bonuses (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.holdem_tables(id) on delete cascade,
  hand_no    int not null,
  seat_id    uuid references public.holdem_seats(id),
  member_id  uuid not null references public.members(id),
  name       text not null,
  uid        text,                                   -- 카톡 점수판 user_id (자리 기록에서)
  hand       text not null,                          -- '로얄 스트레이트 플러시' 등
  cards      text,                                   -- 완성된 5장 (예: ♠A ♠K ♠Q ♠J ♠10)
  points     int not null,
  state      text not null default 'pending' check (state in ('pending', 'paid', 'skipped')),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (table_id, hand_no, member_id)
);
create index if not exists holdem_bonuses_pending_idx on public.holdem_bonuses (created_at) where state = 'pending';
alter table public.holdem_bonuses enable row level security;
