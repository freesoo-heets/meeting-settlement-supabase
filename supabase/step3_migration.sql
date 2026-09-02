-- 1) 회원 최초 입장 날짜 컬럼 추가
alter table public.members
add column if not exists join_date date;

-- 기존 회원은 생성일(created_at)을 최초 입장일로 자동 보정
update public.members
set join_date = created_at::date
where join_date is null;

-- 앞으로 신규 회원은 오늘 날짜를 기본값으로 사용
alter table public.members
alter column join_date set default current_date;

alter table public.members
alter column join_date set not null;

-- 2) 모임 비용은 최초 생성 시 비워둘 수 있게 변경
alter table public.meetings
alter column cost drop not null;

alter table public.meetings
alter column cost drop default;
