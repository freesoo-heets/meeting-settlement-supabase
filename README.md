# 모임 참석·정산 관리 v0.2

Supabase DB 연결 버전입니다.

## 1. Supabase 프로젝트 만들기

Supabase에서 새 프로젝트를 생성합니다.

## 2. DB 테이블 생성

Supabase Dashboard → SQL Editor에서 아래 파일 내용을 실행합니다.

`supabase/schema.sql`

## 3. 환경변수 설정

프로젝트 루트에 `.env.local` 파일을 만들고 입력합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

값은 Supabase Dashboard의 Project Settings / API 또는 Connect 영역에서 확인할 수 있습니다.

## 4. 실행

```bash
npm install
npm run dev
```

브라우저:

http://localhost:3000

## 현재 구현

- Supabase DB 저장
- 회원 추가/삭제
- 모임 추가/삭제
- 날짜별 참석 체크
- 월별 참석횟수 자동 집계
- 모임별 비용
- 참석자 기준 1/N 예상 정산액
- 모바일 반응형

## 중요

현재 SQL 정책은 개발 편의를 위해 anon 사용자도 읽기/쓰기 가능하게 열어둔 상태입니다.

실제 배포 전에는 관리자 로그인(Supabase Auth)을 추가하고 RLS 정책을 관리자 전용으로 변경하는 것을 권장합니다.
