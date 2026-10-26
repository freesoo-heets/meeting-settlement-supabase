-- 🃏 홀덤 게임 중 충전 (칩을 1,000개까지 다시 채움 · 점수가 모자라면 남은 점수 전부)
-- 사이트가 rebuy_state='requested' + rebuy_want 를 적으면 봇이 점수를 차감하고 rebuy_count 를 올린다.
alter table public.holdem_seats add column if not exists rebuy_state text not null default 'none';
alter table public.holdem_seats drop constraint if exists holdem_seats_rebuy_state_check;
alter table public.holdem_seats add constraint holdem_seats_rebuy_state_check
  check (rebuy_state in ('none', 'requested', 'locking', 'locked', 'failed'));
alter table public.holdem_seats add column if not exists rebuy_want integer;
alter table public.holdem_seats add column if not exists rebuy_note text;
alter table public.holdem_seats add column if not exists rebuy_count integer not null default 0;   -- 처리한 충전 횟수
alter table public.holdem_seats add column if not exists last_rebuy integer not null default 0;    -- 마지막 충전 칩
alter table public.holdem_seats add column if not exists rebuy_total integer not null default 0;   -- 충전한 칩 합계 (정산: 바이인 + 이것)
