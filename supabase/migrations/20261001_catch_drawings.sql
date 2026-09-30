-- 캐치마인드 그림 기록 (문제가 끝날 때 출제자 화면이 저장 → 최근 그림 갤러리)
alter table public.catch_rooms add column if not exists play_no integer not null default 0;  -- 다시하기 할 때마다 +1

create table if not exists public.catch_drawings (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.catch_rooms(id) on delete cascade,
  play_no       integer not null default 0,
  turn_no       integer not null,
  drawer_member uuid,
  drawer_name   text not null,
  word          text not null,
  winner        text,                                  -- 맞힌 사람 (없으면 null)
  strokes       jsonb not null default '[]'::jsonb,    -- [{color, size, pts:[[x,y]...]}] 0~1 좌표
  is_test       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (room_id, play_no, turn_no)
);

create index if not exists catch_drawings_created_idx on public.catch_drawings (created_at desc);
alter table public.catch_drawings enable row level security;
drop policy if exists catch_drawings_select on public.catch_drawings;
create policy catch_drawings_select on public.catch_drawings
  for select to authenticated using (public.can_use_app());
