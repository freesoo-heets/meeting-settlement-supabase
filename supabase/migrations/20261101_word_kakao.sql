-- 🌐 카톡에서 시작한 단어게임을 사이트에서도 이어서 한다. 여러 번 실행해도 된다.
--   word_games.source: site = 사이트에서 시작 · kakao = 카톡에서 시작 (봇이 같은 판을 만들고 입력을 맞춘다)
--   word_chat.from_kakao: 카톡 스레드에서 온 대화 (봇이 다시 스레드로 보내지 않게)
alter table public.word_games add column if not exists source text not null default 'site';
alter table public.word_games drop constraint if exists word_games_source_check;
alter table public.word_games add constraint word_games_source_check check (source in ('site', 'kakao'));
alter table public.word_chat add column if not exists from_kakao boolean not null default false;
