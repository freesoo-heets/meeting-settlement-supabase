-- 🎧 노래 맞추기 (카톡 !노래퀴즈 를 사이트에서 · 방 + 여러 곡 연속)
-- 규칙은 카톡과 같다: 방장이 곡당 티켓 2장 (운영진 무료), 맞힌 사람은 카톡 점수판에 30점 (단계마다 x0.8, 최소 5점)
-- 티켓 · 점수는 봇(song_bridge.py)이 처리한다:
--   시작(escrow·requested) → 봇이 이용 시간 · 티켓 확인 후 차감 → playing (모자라면 waiting 으로 되돌리고 reject_reason)
--   정답(song_awards pending) → 봇이 점수 지급 · 카톡 !노래전적 에 합산 (paid)
--   끝남(finished · cancelled) → 못 낸 곡 몫 티켓 반환 (refund_state done)
-- 여러 번 실행해도 된다.

create table if not exists public.song_rooms (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'waiting' check (status in ('waiting', 'escrow', 'playing', 'finished', 'cancelled')),
  host_member    uuid not null references public.members(id),
  host_name      text not null,
  players        jsonb not null default '[]'::jsonb,   -- [{id, name, uid}]  uid = 카톡 점수판 user_id (없으면 점수 없음)
  max_players    int not null default 8,
  topic          text not null default '',             -- '' = K-POP 인기곡 · '팝송' · '2010년대' · 가수 이름
  song_total     int not null default 5,
  song_no        int not null default 0,               -- 지금 곡 (0부터)
  songs_played   int not null default 0,               -- 실제로 낸 곡 수 (티켓 반환 계산)
  stage          int not null default 0,               -- 0·1·2 = 2·4·6초 듣기, 3 = 가수 힌트, 4 = 제목 힌트
  phase          text check (phase in ('intro', 'listen', 'reveal')),
  phase_deadline timestamptz,
  hint_artist    text,
  hint_title     text,
  reveal_title   text,
  reveal_artist  text,
  reveal_art     text,
  last_winner    text,
  last_points    int,
  scores         jsonb not null default '{}'::jsonb,
  escrow_state   text not null default 'none' check (escrow_state in ('none', 'requested', 'locked', 'failed')),
  reject_reason  text,
  cost           int not null default 0,                -- 방장이 낸 티켓 (봇이 채운다, 운영진은 0)
  refund_state   text not null default 'none' check (refund_state in ('none', 'done')),
  is_test        boolean not null default false,
  recruit_at     timestamptz,
  recruit_no     int not null default 0,
  play_no        int not null default 0,
  announced      boolean not null default false,        -- 결과를 카톡방에 올렸는지
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists song_rooms_status_idx on public.song_rooms (status, created_at desc);
alter table public.song_rooms enable row level security;
drop policy if exists song_rooms_select on public.song_rooms;
create policy song_rooms_select on public.song_rooms
  for select to authenticated using (public.can_use_app());

-- 정답 · 음원 주소 (화면에서 못 읽게 정책 없음)
create table if not exists public.song_secrets (
  room_id    uuid not null references public.song_rooms(id) on delete cascade,
  play_no    int not null default 0,
  song_no    int not null,
  track_id   text not null,
  title      text not null,
  artist     text not null,
  year       text,
  preview    text not null,
  artwork    text,
  answers    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (room_id, play_no, song_no)
);
create index if not exists song_secrets_recent_idx on public.song_secrets (created_at desc);
alter table public.song_secrets enable row level security;

-- 정답 점수 (봇이 카톡 점수판에 넣는다)
create table if not exists public.song_awards (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.song_rooms(id) on delete cascade,
  play_no    int not null default 0,
  song_no    int not null,
  member_id  uuid not null references public.members(id),
  name       text not null,
  uid        text,
  points     int not null,
  title      text not null,
  artist     text,
  stage      int not null default 0,
  state      text not null default 'pending' check (state in ('pending', 'paid', 'skipped')),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, play_no, song_no)
);
create index if not exists song_awards_pending_idx on public.song_awards (created_at) where state = 'pending';
alter table public.song_awards enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'song_rooms') then
    alter publication supabase_realtime add table public.song_rooms;
  end if;
end $$;
