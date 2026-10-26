-- 🃏 텍사스 홀덤 (점수 내기 · 자유 입퇴장 · 2~6명)
-- 흐름: 자리 신청(escrow·requested) → 봇이 1000점 · 티켓 1장 차감(locked, seated)
--       → 판 진행(서버 API) → 일어나면(left) 남은 칩을 봇이 점수로 돌려줌 (딴 금액의 5% 수수료)
-- 화면은 읽기만 한다. 쓰기는 서버 API(service_role)와 봇만 한다.

-- 테이블(방): 공개 상태만 담는다 (남의 손패는 없음)
create table if not exists public.holdem_tables (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'waiting'
                check (status in ('waiting', 'playing', 'closed')),
  host_member   uuid not null references public.members(id),
  host_name     text not null,
  is_test       boolean not null default false,
  is_friendly   boolean not null default false,
  max_seats     integer not null default 6,
  view          jsonb not null default '{}'::jsonb,   -- 화면용 상태 (손패는 쇼다운 공개분만)
  version       integer not null default 0,
  hand_no       integer not null default 0,
  turn_deadline timestamptz,
  next_hand_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists holdem_tables_status_idx on public.holdem_tables (status, created_at desc);
alter table public.holdem_tables enable row level security;
drop policy if exists holdem_tables_select on public.holdem_tables;
create policy holdem_tables_select on public.holdem_tables
  for select to authenticated using (public.can_use_app());

-- 자리(한 번 앉았다 일어날 때까지 = 기록 한 줄). 지워지지 않는 게임 기록
create table if not exists public.holdem_seats (
  id            uuid primary key default gen_random_uuid(),
  table_id      uuid not null references public.holdem_tables(id),
  member_id     uuid not null references public.members(id),
  name          text not null,
  uid           text not null,                 -- 카톡 user_id (봇 점수판 키). 친선 무료면 'friendly'
  status        text not null default 'escrow'
                check (status in ('escrow', 'seated', 'left', 'failed', 'cancelled')),
  buy_in        integer not null default 1000,
  is_friendly   boolean not null default false,
  is_test       boolean not null default false,
  escrow_state  text not null default 'requested'
                check (escrow_state in ('none', 'requested', 'locking', 'locked', 'failed')),
  escrow_note   text,
  cash_out      integer,                        -- 일어날 때 남은 칩
  hands         integer not null default 0,     -- 참여한 판 수
  settle_state  text not null default 'none'
                check (settle_state in ('none', 'settling', 'done')),
  payout        integer,                        -- 봇이 돌려준 점수 (수수료 뺀 것)
  fee           integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  seated_at     timestamptz,
  left_at       timestamptz
);
create index if not exists holdem_seats_table_idx on public.holdem_seats (table_id, created_at);
create index if not exists holdem_seats_member_idx on public.holdem_seats (member_id, created_at desc);
create index if not exists holdem_seats_status_idx on public.holdem_seats (status, escrow_state, settle_state);
alter table public.holdem_seats enable row level security;
drop policy if exists holdem_seats_select on public.holdem_seats;
create policy holdem_seats_select on public.holdem_seats
  for select to authenticated using (public.can_use_app());

-- 전체 상태(덱 · 모두의 손패): 서버만 읽는다 (정책 없음 = 회원도 못 읽음)
create table if not exists public.holdem_secrets (
  table_id  uuid primary key references public.holdem_tables(id) on delete cascade,
  state     jsonb not null default '{}'::jsonb,
  version   integer not null default 0
);
alter table public.holdem_secrets enable row level security;

-- 카톡 초대 요청 종류에 홀덤 추가
alter table public.bot_announcements drop constraint if exists bot_announcements_kind_check;
alter table public.bot_announcements add constraint bot_announcements_kind_check
  check (kind in ('omok', 'alkkagi', 'holdem'));

alter publication supabase_realtime add table public.holdem_tables;
alter publication supabase_realtime add table public.holdem_seats;
