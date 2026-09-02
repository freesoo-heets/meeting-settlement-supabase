-- Step 15: 개인 최초 가입 방식
-- Step 14 SQL 실행 후 적용하세요.
-- 회원 생성 자체는 서버 API가 service-role secret key로 처리하므로
-- 일반 사용자가 members 테이블에 직접 INSERT할 수 있는 권한은 부여하지 않습니다.

-- 닉네임 대소문자 중복 방지 인덱스가 기존 프로젝트에 없다면 생성합니다.
create unique index if not exists members_name_unique
on public.members (lower(name));

-- profiles 닉네임 키도 대소문자 기준으로 유일하게 유지합니다.
create unique index if not exists profiles_nickname_key_unique
on public.profiles (nickname_key);

-- 일반 회원에게 회원 테이블 직접 추가/수정 권한은 계속 주지 않습니다.
-- 회원 추가/탈퇴/입장일 수정 정책은 Step 14의 관리자 정책을 유지합니다.
