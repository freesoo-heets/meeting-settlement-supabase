# JJINCHIN PET 통합 계획

## 목표

모임페이지를 메인 앱으로 유지하고, 기존 `jjinchin-pet`의 PET 기능을 단계적으로 내부 탭으로 흡수한다.

사용자는 모임페이지 로그인만 사용하며, PET 별도 로그인은 최종적으로 제거한다.

## 통합 원칙

1. 기존 운영 모임/정산 기능을 깨지 않는다.
2. 기존 PET 데이터와 PET Supabase는 1차 통합에서 이동하지 않는다.
3. 브라우저가 PET 서버를 직접 호출하지 않는다.
4. 로그인 사용자의 `profiles.member_id`를 PET 연동 외부키로 사용한다.
5. PET 조작 대상 ID는 브라우저 입력을 신뢰하지 않고 서버가 연결정보에서 결정한다.
6. 기존 참석 보상 Outbox와 중복지급 방지 구조는 유지한다.
7. UI 통합이 안정된 후에만 DB 통합을 검토한다.

## 현재 연결 구조

```
Meeting Supabase
profiles.member_id
      │
      ▼
meeting /api/pet/*
      │ server-to-server
      ▼
PET /api/integration/meeting/*
      │
      ▼
meeting_member_links.external_member_id
      │
      ▼
PET profiles.id → pets / wallet / inventory / missions
```

## STEP 32.0 — 통합 기반

### PET 서버

`GET /api/integration/meeting/me?externalMemberId=...`

반환:

- 연동 여부
- PET 존재 여부
- PET 이름/종/레벨/EXP
- 포만감/행복/에너지/친밀도
- PET Coin
- 공개 코드
- 행동별 현재 쿨타임
- 서버 시간

인증:

`Authorization: Bearer MEETING_INTEGRATION_SECRET`

### Meeting 서버

`GET /api/pet/me`

브라우저는 Meeting Supabase access token만 전달한다.

Meeting 서버가:

1. access token 검증
2. 로그인 profile 조회
3. `profile.member_id` 확보
4. PET integration endpoint 호출
5. 브라우저로 필요한 PET 요약만 반환

브라우저는 PET profile ID나 external member ID를 요청값으로 지정하지 않는다.

## STEP 32.1 — PET 탭 Preview

모임페이지에 기능 플래그로 숨겨진 PET 탭을 추가한다.

초기 화면:

- PET Hero
- Lv / EXP / 친밀도
- 포만감 / 행복 / 에너지
- Coin
- 행동 4종 상태

이 단계에서는 읽기 전용으로 먼저 검증한다.

## STEP 32.2 — PET 행동 통합

추가 프록시:

- `POST /api/pet/action`
- `GET /api/pet/action-status`
- `POST /api/pet/checkin`
- `POST /api/pet/coin-services`

모든 PET 서버 endpoint는 연결된 `member_id`를 기준으로 대상 PET을 결정한다.

## STEP 32.3 — Inventory / Growth

- 인벤토리
- 아이템 사용/장착
- 성장도감
- 업적 및 보상
- Coin Shop

## STEP 32.4 — Friends

- 친구 PET
- 방문
- 쓰다듬기
- 공개 PET

모임 회원과 PET 친구 모델을 연결할 수 있는지 별도 검토한다.

## STEP 32.5 — 모임 기능과 결합

- 모임 상세에 PET 참석 보상 표시
- 참석 완료 보상 toast
- 회원 상세에 PET 요약
- 관리자 PET 보상/연동 상태
- PET 보상 Outbox 상태 모니터링

## STEP 33 — 단일 앱 전환

충분한 운영 검증 후:

1. 기존 PET 사이트를 fallback으로 유지
2. 모임페이지 PET 탭을 기본 진입점으로 전환
3. PET 별도 로그인 신규 사용 중단
4. 기존 PET URL 안내/리다이렉트 검토

## 최종 단계 — DB 통합

UI/인증 통합과 충분한 안정화 이후에만 진행한다.

PET 테이블을 Meeting Supabase로 옮기면 server-to-server 통신 일부를 제거할 수 있지만,
운영 데이터 migration과 ID mapping 검증이 필요하므로 별도 프로젝트로 수행한다.

## 롤백 전략

STEP 32~33 동안 PET 데이터 원본은 기존 PET Supabase에 유지한다.

모임페이지 통합 UI에서 문제가 발생하면 PET 탭/기능 플래그만 비활성화하고 기존
`jjinchin-pet.vercel.app`을 즉시 fallback으로 사용할 수 있다.
