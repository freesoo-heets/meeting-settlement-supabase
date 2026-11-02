-- ⚙️ 사이트 점수 · 티켓 관리 요청. 사이트 API 가 requested 로 넣고 → 봇이 점수판에 반영한 뒤 done (실패는 failed)
-- 쓰기 · 읽기 모두 사이트 API(서비스 키)와 봇만. 화면에서 직접 읽지 않는다
create table if not exists public.point_adjustments (
  id            uuid primary key default gen_random_uuid(),
  uid           text not null,
  name          text not null,
  points        integer not null default 0,
  tickets       integer not null default 0,
  reason        text,
  admin_member  uuid not null references public.members(id),
  admin_name    text not null,
  state         text not null default 'requested' check (state in ('requested', 'processing', 'done', 'failed')),
  error         text,
  exp_after     integer,
  tickets_after integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (points <> 0 or tickets <> 0)
);
create index if not exists point_adjustments_state_idx on public.point_adjustments (state, created_at);
create index if not exists point_adjustments_uid_idx on public.point_adjustments (uid, created_at desc);
alter table public.point_adjustments enable row level security;
