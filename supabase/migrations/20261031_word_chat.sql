-- 단어게임 채팅 기록 (관전 중 남긴 힌트를 나중에 와서도 볼 수 있게). 쓰기는 사이트 API 만
create table if not exists public.word_chat (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.word_games(id) on delete cascade,
  member_id   uuid not null references public.members(id),
  name        text not null,
  text        text not null check (char_length(text) between 1 and 80),
  created_at  timestamptz not null default now()
);
create index if not exists word_chat_game_idx on public.word_chat (game_id, created_at);
alter table public.word_chat enable row level security;
drop policy if exists word_chat_select on public.word_chat;
create policy word_chat_select on public.word_chat
  for select to authenticated using (public.can_use_app());
