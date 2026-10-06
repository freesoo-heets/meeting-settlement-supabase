-- 캐치마인드 정답 기록 (그림 저장과 별개로, 정답을 맞힐 때마다 서버가 바로 남긴다)
create table if not exists public.catch_correct (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null,
  play_no     integer not null default 0,
  turn_no     integer not null,
  member_id   uuid not null,
  name        text not null,
  word        text,
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (room_id, play_no, turn_no)
);

create index if not exists catch_correct_member_idx on public.catch_correct (member_id);
alter table public.catch_correct enable row level security;
drop policy if exists catch_correct_select on public.catch_correct;
create policy catch_correct_select on public.catch_correct
  for select to authenticated using (public.can_use_app());

-- 지금까지 그림 기록에 남은 정답을 옮겨 둔다 (이름으로 회원 찾기)
insert into public.catch_correct (room_id, play_no, turn_no, member_id, name, word, is_test, created_at)
select d.room_id, d.play_no, d.turn_no, m.id, d.winner, d.word, d.is_test, d.created_at
from public.catch_drawings d
join public.members m on m.name = d.winner
where d.winner is not null
on conflict (room_id, play_no, turn_no) do nothing;
