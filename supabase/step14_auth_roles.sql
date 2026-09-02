-- Step 14: 로그인 + owner/admin/user 권한
-- 중요: 실행 전 Step 13까지 적용되어 있어야 합니다.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade,
  nickname text not null,
  nickname_key text not null unique,
  auth_email text not null unique,
  role text not null default 'user'
    check (role in ('owner', 'admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
  );
$$;

create or replace function public.can_use_app()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.members m on m.id = p.member_id
    where p.id = auth.uid()
      and (
        p.role in ('owner', 'admin')
        or coalesce(m.active, false) = true
      )
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.can_use_app() to authenticated;

-- 기존 개발용 공개 RLS 정책을 제거합니다.
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'members',
        'meetings',
        'attendance',
        'settlement_adjustments',
        'meeting_guests',
        'meeting_prepayments',
        'monthly_prepayments',
        'payments',
        'profiles'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      p.policyname,
      p.tablename
    );
  end loop;
end $$;

-- profiles: 로그인 사용자는 자신의 프로필을 읽을 수 있고,
-- 앱 사용 권한이 있는 사용자는 역할 표시를 위해 프로필 목록을 읽을 수 있습니다.
create policy "profiles select authenticated"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.can_use_app());

-- 관리자 지정/해제는 제작자(owner)만 가능합니다.
create policy "profiles owner update"
on public.profiles
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

-- 회원 목록은 로그인한 앱 사용자에게 조회 허용.
create policy "members authenticated select"
on public.members
for select
to authenticated
using (public.can_use_app());

-- 회원 추가는 owner/admin만.
create policy "members admin insert"
on public.members
for insert
to authenticated
with check (public.is_admin());

-- 탈퇴/복귀 및 입장일 수정 포함 회원 UPDATE는 owner/admin만.
create policy "members admin update"
on public.members
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 현재 UI에는 회원 삭제가 없지만, 추후 삭제도 관리자만 허용.
create policy "members admin delete"
on public.members
for delete
to authenticated
using (public.is_admin());

-- 아래 기능은 요청대로 일반 로그인 회원도 사용 가능:
-- 모임, 참석, 게스트, 비용, 특정값, 모임별 선입금.
create policy "meetings authenticated all"
on public.meetings
for all
to authenticated
using (public.can_use_app())
with check (public.can_use_app());

create policy "attendance authenticated all"
on public.attendance
for all
to authenticated
using (public.can_use_app())
with check (public.can_use_app());

create policy "settlement adjustments authenticated all"
on public.settlement_adjustments
for all
to authenticated
using (public.can_use_app())
with check (public.can_use_app());

create policy "meeting guests authenticated all"
on public.meeting_guests
for all
to authenticated
using (public.can_use_app())
with check (public.can_use_app());

create policy "meeting prepayments authenticated all"
on public.meeting_prepayments
for all
to authenticated
using (public.can_use_app())
with check (public.can_use_app());

-- 과거 테이블이 존재하는 경우에도 anon 접근을 막습니다.
do $$
begin
  if to_regclass('public.monthly_prepayments') is not null then
    execute '
      create policy "monthly prepayments authenticated all"
      on public.monthly_prepayments
      for all
      to authenticated
      using (public.can_use_app())
      with check (public.can_use_app())
    ';
  end if;

  if to_regclass('public.payments') is not null then
    execute '
      create policy "payments authenticated all"
      on public.payments
      for all
      to authenticated
      using (public.can_use_app())
      with check (public.can_use_app())
    ';
  end if;
end $$;

revoke all on table public.members from anon;
revoke all on table public.meetings from anon;
revoke all on table public.attendance from anon;
revoke all on table public.settlement_adjustments from anon;
revoke all on table public.meeting_guests from anon;
revoke all on table public.meeting_prepayments from anon;
revoke all on table public.profiles from anon;

grant select, insert, update, delete on table public.members to authenticated;
grant select, insert, update, delete on table public.meetings to authenticated;
grant select, insert, update, delete on table public.attendance to authenticated;
grant select, insert, update, delete on table public.settlement_adjustments to authenticated;
grant select, insert, update, delete on table public.meeting_guests to authenticated;
grant select, insert, update, delete on table public.meeting_prepayments to authenticated;
grant select, update on table public.profiles to authenticated;
