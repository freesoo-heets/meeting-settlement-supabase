-- 오늘의 단어 (카톡 !단어 게임을 사이트에서)
-- 점수·티켓은 봇이 처리한다: 시작(escrow) → 봇이 티켓 1장(없으면 50점 자동구매) 차감 · 정답 단어를 정해 playing
--   끝나면(won · lost) 봇이 보상 지급 · 카톡 !단어 전적에 합산 (settle_state done)
-- 여러 번 실행해도 된다.

-- 단어장 (봇 wordle_dict.json · wordle_invalid_dict.json 과 같이 맞춘다)
--   valid: true = 쓸 수 있는 단어, false = 부적합, null = AI 검증 대기 (사이트에서 처음 나온 단어)
create table if not exists public.word_dict (
  word        text primary key,
  jamo        text not null,
  valid       boolean,
  reason      text,
  updated_at  timestamptz not null default now()
);
create index if not exists word_dict_jamo_idx on public.word_dict (jamo);
create index if not exists word_dict_pending_idx on public.word_dict (updated_at) where valid is null;
alter table public.word_dict enable row level security;   -- 정책 없음: 서버 · 봇만

-- 한 판 = 한 줄 (지워지지 않는 기록)
create table if not exists public.word_games (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id),
  name          text not null,
  uid           text not null,
  status        text not null default 'escrow' check (status in ('escrow', 'playing', 'won', 'lost', 'rejected')),
  escrow_state  text not null default 'requested' check (escrow_state in ('requested', 'locked', 'failed')),
  reject_reason text,
  auto_bought   boolean not null default false,
  hint_len      int,                                  -- 정답 글자 수 (힌트)
  history       jsonb not null default '[]'::jsonb,   -- [{jamo: [...5], result: ['g'|'y'|'x', ...]}]
  tries         int not null default 0,
  max_tries     int not null default 5,
  answer        text,                                 -- 끝난 뒤에만 채운다
  reward        int not null default 0,
  settle_state  text not null default 'none' check (settle_state in ('none', 'done')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists word_games_member_idx on public.word_games (member_id, created_at desc);
create index if not exists word_games_status_idx on public.word_games (status, created_at desc);
alter table public.word_games enable row level security;
drop policy if exists word_games_select on public.word_games;
create policy word_games_select on public.word_games
  for select to authenticated using (public.can_use_app());

-- 정답 (화면에서 못 읽게 정책 없음)
create table if not exists public.word_secrets (
  game_id     uuid primary key references public.word_games(id) on delete cascade,
  target      text not null,
  target_jamo text not null
);
alter table public.word_secrets enable row level security;
