-- STEP 22: 관리자 회원 추가 권한 보장
-- 기존 정책이 있어도 안전하게 재생성합니다.

alter table public.members enable row level security;

drop policy if exists "members admin insert" on public.members;

create policy "members admin insert"
on public.members
for insert
to authenticated
with check (public.is_admin());

-- 닉네임 중복 방지(대소문자 무시)
create unique index if not exists members_name_unique
on public.members (lower(name));
