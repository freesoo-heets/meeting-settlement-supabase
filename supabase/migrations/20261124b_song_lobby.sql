-- 🎧 노래 맞추기 → 늘 열려 있는 방 하나 (2026-11-24 사용자 요청)
--   방장 개념 없이 아무나 들어와 주제 · 전주/하이라이트를 골라 바로 출제 (한 번에 1곡, 출제자 티켓 2장 · 운영진 무료)
--   전주는 봇 폰이 원곡 앞부분을 잘라 song-clips 저장소에 올린다 (하이라이트는 애플 미리듣기 그대로)
-- 여러 번 실행해도 된다.

alter table public.song_rooms add column if not exists is_lobby boolean not null default false;
alter table public.song_rooms add column if not exists mode text not null default 'highlight';
alter table public.song_rooms drop constraint if exists song_rooms_mode_check;
alter table public.song_rooms add constraint song_rooms_mode_check check (mode in ('highlight', 'intro'));
alter table public.song_rooms add column if not exists opener_member uuid references public.members(id);
alter table public.song_rooms add column if not exists opener_name text;
alter table public.song_rooms add column if not exists opener_uid text;
alter table public.song_rooms add column if not exists notice text;
create unique index if not exists song_rooms_one_lobby on public.song_rooms (is_lobby) where is_lobby;

alter table public.song_secrets add column if not exists mode text not null default 'highlight';
alter table public.song_secrets add column if not exists clip_path text;      -- 전주 조각 (song-clips 저장소)
alter table public.song_secrets add column if not exists duration_ms int;     -- 원곡 길이 (유튜브에서 같은 곡 고를 때)

-- 오늘의 순위 (끝난 곡의 정답자 · 제목은 이미 공개된 것)
drop policy if exists song_awards_select on public.song_awards;
create policy song_awards_select on public.song_awards
  for select to authenticated using (public.can_use_app());

-- 전주 조각 저장소 (비공개 · 서버와 봇만)
insert into storage.buckets (id, name, public)
values ('song-clips', 'song-clips', false)
on conflict (id) do nothing;

-- 예전 여러 방 방식의 열린 방 정리 (모두 테스트 방이었다)
update public.song_rooms set status = 'cancelled', updated_at = now()
where not is_lobby and status in ('waiting', 'escrow', 'playing');
