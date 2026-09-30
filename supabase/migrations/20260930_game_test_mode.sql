-- 관리자 게임 테스트 모드
-- 테스트 판은 판돈 0 · 봇 차감/정산 없음 · 다른 회원 목록에 안 보임
alter table public.omok_games add column if not exists is_test boolean not null default false;
alter table public.omok_games drop constraint if exists omok_games_stake_check;
alter table public.omok_games add constraint omok_games_stake_check
  check (is_test or stake between 10 and 1000);

alter table public.alkkagi_games add column if not exists is_test boolean not null default false;
alter table public.alkkagi_games drop constraint if exists alkkagi_games_stake_check;
alter table public.alkkagi_games add constraint alkkagi_games_stake_check
  check (is_test or stake between 10 and 1000);

alter table public.catch_rooms add column if not exists is_test boolean not null default false;
