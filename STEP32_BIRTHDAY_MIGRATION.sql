-- STEP 32: 회원 생일 정보
alter table public.members
  add column if not exists birthday date;

comment on column public.members.birthday is
  '회원 생일. 최초 가입 또는 관리자 수정으로 저장하며 NULL 허용.';
