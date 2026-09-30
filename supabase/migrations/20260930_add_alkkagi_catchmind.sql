-- 알까기 (장기알 · 점수 내기) + 캐치마인드 (점수 없음)
-- 쓰기는 서버 API(service_role)와 봇만 한다. 화면은 로그인 회원이 읽기만 한다.

-- ───────── 알까기 ─────────
-- 흐름은 오목과 같다: open/challenge → escrow(봇 차감) → playing → finished(봇 정산)
create table if not exists public.alkkagi_games (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'open'
                check (status in ('open', 'challenge', 'escrow', 'playing', 'finished', 'cancelled')),
  stake         integer not null check (stake between 10 and 1000),

  host_member   uuid not null references public.members(id),
  host_name     text not null,
  host_uid      text not null,
  guest_member  uuid references public.members(id),
  guest_name    text,
  guest_uid     text,
  target_member uuid references public.members(id),

  cho           text check (cho in ('host', 'guest')),   -- 초(아래쪽, 선공)
  turn          text check (turn in ('host', 'guest')),
  pieces        jsonb not null default '[]'::jsonb,      -- [{id, side, kind, x, y, out}]
  last_shot     jsonb,                                    -- {no, id, vx, vy, before:[...]}  화면 재생용
  shot_no       integer not null default 0,
  strikes       jsonb not null default '{"host":0,"guest":0}'::jsonb,  -- 연속 시간 초과
  turn_deadline timestamptz,

  winner        text check (winner in ('host', 'guest', 'draw')),
  end_reason    text,

  escrow_state  text not null default 'none'
                check (escrow_state in ('none', 'requested', 'locking', 'locked', 'failed')),
  escrow_note   text,
  settle_state  text not null default 'none'
                check (settle_state in ('none', 'settling', 'done')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create index if not exists alkkagi_games_status_idx on public.alkkagi_games (status, created_at desc);
alter table public.alkkagi_games enable row level security;
drop policy if exists alkkagi_games_select on public.alkkagi_games;
create policy alkkagi_games_select on public.alkkagi_games
  for select to authenticated using (public.can_use_app());

-- ───────── 캐치마인드 ─────────
create table if not exists public.catch_rooms (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'waiting'
                 check (status in ('waiting', 'playing', 'finished', 'cancelled')),
  host_member    uuid not null references public.members(id),
  host_name      text not null,
  players        jsonb not null default '[]'::jsonb,   -- [{id, name}] 출제 순서
  max_players    integer not null default 6,
  rounds         integer not null default 2,           -- 한 사람당 출제 횟수
  turn_no        integer not null default 0,           -- 0부터
  turn_total     integer not null default 0,
  drawer_member  uuid,
  drawer_name    text,
  phase          text check (phase in ('drawing', 'reveal')),
  phase_deadline timestamptz,
  hint           text,                                  -- 예: "○○○ (3글자)"
  reveal_word    text,                                  -- 턴이 끝난 뒤에만 채운다
  last_winner    text,
  scores         jsonb not null default '{}'::jsonb,    -- {member_id: 점수}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists catch_rooms_status_idx on public.catch_rooms (status, created_at desc);
alter table public.catch_rooms enable row level security;
drop policy if exists catch_rooms_select on public.catch_rooms;
create policy catch_rooms_select on public.catch_rooms
  for select to authenticated using (public.can_use_app());

-- 제시어는 서버만 읽는다 (정책 없음 = 로그인 회원도 못 읽음)
create table if not exists public.catch_secrets (
  room_id  uuid primary key references public.catch_rooms(id) on delete cascade,
  word     text,
  used     jsonb not null default '[]'::jsonb
);
alter table public.catch_secrets enable row level security;

-- 실시간 반영
alter publication supabase_realtime add table public.alkkagi_games;
alter publication supabase_realtime add table public.catch_rooms;
