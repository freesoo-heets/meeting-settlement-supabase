-- 📝 단어장 고치기 요청. 사이트 API · 봇이 넣고 → 봇이 단어장 파일(wordle_dict · wordle_invalid_dict)과 word_dict 를 고친다
--   action: add = 운영진 추가 · delete = 운영진 바로 삭제 · request = 회원 삭제 요청 (AI 판단)
--   state:  requested → done (result: added · deleted · kept) · failed
--           애매한 요청은 asked (운영진이 사이트 또는 카톡방에서 삭제 · 유지를 정한다)
-- 쓰기 · 읽기는 사이트 API(서비스 키)와 봇만. 여러 번 실행해도 된다.
create table if not exists public.word_edits (
  id          uuid primary key default gen_random_uuid(),
  word        text not null,
  action      text not null check (action in ('add', 'delete', 'request')),
  source      text not null default 'site' check (source in ('site', 'kakao')),
  member_id   uuid references public.members(id),   -- 카톡 요청은 비어 있다
  name        text not null,
  state       text not null default 'requested' check (state in ('requested', 'asked', 'done', 'failed')),
  result      text check (result in ('added', 'deleted', 'kept')),
  reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists word_edits_state_idx on public.word_edits (state, created_at);
create index if not exists word_edits_word_idx on public.word_edits (word, updated_at desc);
alter table public.word_edits enable row level security;   -- 정책 없음: 서버 · 봇만
