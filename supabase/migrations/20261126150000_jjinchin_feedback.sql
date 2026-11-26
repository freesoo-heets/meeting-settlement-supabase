-- 찐친 소리함: 내용과 작성자 식별자를 분리하고 모든 읽기/쓰기를 검증된 서버 API에 한정한다.
create table if not exists public.jjinchin_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('suggestion','complaint','concern','other')),
  title text not null check (char_length(title) between 2 and 120),
  content text not null check (char_length(content) between 5 and 4000),
  anonymous boolean not null default true,
  status text not null default 'received' check (status in ('received','reviewing','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.jjinchin_feedback_authors (
  feedback_id uuid primary key references public.jjinchin_feedback(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname_at_submission text not null,
  created_at timestamptz not null default now()
);
create index if not exists jjinchin_feedback_authors_user_idx on public.jjinchin_feedback_authors (user_id);
create index if not exists jjinchin_feedback_created_idx on public.jjinchin_feedback (created_at desc);
create table if not exists public.jjinchin_feedback_replies (
  feedback_id uuid primary key references public.jjinchin_feedback(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  replied_by uuid not null references auth.users(id),
  replied_at timestamptz not null default now()
);
create table if not exists public.jjinchin_feedback_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
-- 직접 Supabase 클라이언트로 조회/수정하는 경로는 열지 않는다.
alter table public.jjinchin_feedback enable row level security;
alter table public.jjinchin_feedback_authors enable row level security;
alter table public.jjinchin_feedback_replies enable row level security;
alter table public.jjinchin_feedback_reviewers enable row level security;
revoke all on public.jjinchin_feedback, public.jjinchin_feedback_authors, public.jjinchin_feedback_replies, public.jjinchin_feedback_reviewers from anon, authenticated;
grant all on public.jjinchin_feedback, public.jjinchin_feedback_authors, public.jjinchin_feedback_replies, public.jjinchin_feedback_reviewers to service_role;
-- 재배포 전에 기존 같은 이름의 정책이 없음을 확인한다.
