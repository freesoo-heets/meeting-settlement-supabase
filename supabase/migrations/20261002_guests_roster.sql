-- 게스트 회원 + 카톡방 인원 명단
-- 가입할 때 카톡방 명단(room_roster)에 없는 닉네임이면 members.is_guest = true 로 등록한다
alter table public.members add column if not exists is_guest boolean not null default false;

-- 봇이 1분마다 올리는 카톡방 인원 (짧은 닉네임)
create table if not exists public.room_roster (
  name      text primary key,      -- 짧은 닉네임 ('카티')
  full_nick text,                  -- 카톡 전체 닉네임 ('카티 91 남 화곡')
  synced_at timestamptz not null default now()
);
alter table public.room_roster enable row level security;
drop policy if exists room_roster_select on public.room_roster;
create policy room_roster_select on public.room_roster
  for select to authenticated using (public.can_use_app());
-- 쓰기는 봇(service_role)만
