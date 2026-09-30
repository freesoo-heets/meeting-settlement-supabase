-- 오목·알까기 친선 모드 (티켓·점수 없음, 봇 차감/정산 없음)
alter table public.omok_games add column if not exists is_friendly boolean not null default false;
alter table public.omok_games drop constraint if exists omok_games_stake_check;
alter table public.omok_games add constraint omok_games_stake_check
  check (is_test or is_friendly or stake between 10 and 1000);

alter table public.alkkagi_games add column if not exists is_friendly boolean not null default false;
alter table public.alkkagi_games drop constraint if exists alkkagi_games_stake_check;
alter table public.alkkagi_games add constraint alkkagi_games_stake_check
  check (is_test or is_friendly or stake between 10 and 1000);
