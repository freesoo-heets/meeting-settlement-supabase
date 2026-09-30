-- 오목 대국 (렌주룰 · 점수 내기)
-- 흐름: open/challenge → escrow(봇이 판돈·티켓 차감) → playing → finished(봇이 정산)
-- 사이트 화면은 읽기만 한다. 쓰기는 서버 API(service_role)와 봇만 한다.
create table if not exists public.omok_games (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'open'
                check (status in ('open', 'challenge', 'escrow', 'playing', 'finished', 'cancelled')),
  stake         integer not null check (stake between 10 and 1000),

  host_member   uuid not null references public.members(id),
  host_name     text not null,
  host_uid      text not null,              -- 카톡 user_id (봇 점수판 키)
  guest_member  uuid references public.members(id),
  guest_name    text,
  guest_uid     text,
  target_member uuid references public.members(id),   -- 지목 도전 상대

  black         text check (black in ('host', 'guest')),
  moves         jsonb not null default '[]'::jsonb,   -- [[x,y], ...] 첫 수가 흑
  turn_deadline timestamptz,

  winner        text check (winner in ('host', 'guest', 'draw')),
  end_reason    text,                       -- five | timeout | resign | draw | cancel | escrow_failed

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

create index if not exists omok_games_status_idx on public.omok_games (status, created_at desc);

alter table public.omok_games enable row level security;

drop policy if exists omok_games_select on public.omok_games;
create policy omok_games_select on public.omok_games
  for select to authenticated using (public.can_use_app());

-- 쓰기 정책은 두지 않는다: 서버 API 와 봇(service_role)만 쓴다.
