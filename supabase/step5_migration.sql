-- 회원 탈퇴일 기록 컬럼 추가
alter table public.members
add column if not exists withdrawn_at date;

-- 기존 탈퇴 회원은 정확한 과거 탈퇴일을 알 수 없으므로 오늘 날짜로 보정
update public.members
set withdrawn_at = current_date
where active = false
  and withdrawn_at is null;
