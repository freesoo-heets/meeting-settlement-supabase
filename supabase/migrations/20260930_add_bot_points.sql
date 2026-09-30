-- 카톡 봇 점수판 스냅샷
-- 봇(point_sync.py)이 service_role 키로 주기적으로 통째로 올린다.
-- 사이트는 로그인한 회원이 읽기만 한다.
create table if not exists public.bot_points (
  kakao_uid   text primary key,             -- 카톡 user_id (점수판 저장 키)
  name        text not null,                -- 짧은 닉네임 (members.name 과 매칭)
  full_name   text,                         -- 카톡 전체 닉네임
  exp         integer not null default 0,
  rank        integer,
  trophies    text,
  tickets     integer not null default 0,
  season      integer,
  last_active timestamptz,
  synced_at   timestamptz not null default now()
);

create index if not exists bot_points_name_idx on public.bot_points (name);

alter table public.bot_points enable row level security;

drop policy if exists bot_points_select on public.bot_points;
create policy bot_points_select on public.bot_points
  for select to authenticated using (public.can_use_app());

-- 쓰기 정책은 두지 않는다: service_role(봇)만 쓸 수 있다.
