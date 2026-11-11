# JJINCHIN PET 완전 통합 계획

## 최종 목표

`jjinchin-pet`를 별도 서비스로 유지하지 않고,
`meeting-settlement-supabase` 안에 PET의 UI, API, 비즈니스 로직, DB 데이터를 모두 흡수한다.

최종 상태:

```
meeting-settlement-supabase
├─ 모임 / 회원 / 정산 / 게임
├─ 타로
└─ PET
   ├─ PET Hero / 상태 / 돌보기
   ├─ Coin / 출석
   ├─ 인벤토리 / 상점
   ├─ 성장 / 업적
   ├─ 친구 PET
   └─ 모임 참석 보상
```

`jjinchin-pet.vercel.app`은 충분한 검증 이후 종료하거나 통합 페이지로 리다이렉트한다.

---

## 현재 병행 작업과 충돌 방지

현재 모임페이지에서는 타로 통합이 동시에 진행 중이다.

PET 작업 중 다음 파일/영역은 타로 작업이 안정될 때까지 직접 수정하지 않는다.

- `app/page.tsx`의 추가기능 FAB / 추가기능 모달
- `app/tarot/**`
- 타로 진입 URL / 타로 UI
- 타로 통합용 환경변수 및 인증 흐름

PET 작업은 우선 다음 경계 안에서 진행한다.

- `app/api/pet/**`
- `components/pet/**`
- `lib/pet/**`
- `docs/pet-*.md`
- PET 전용 Supabase migration

메인 네비게이션 연결은 PET 내부 기능이 준비된 뒤 최신 `app/page.tsx`를 다시 읽고 최소 변경으로 적용한다.

---

## 핵심 원칙

1. 기존 모임 운영 기능과 타로 통합을 깨지 않는다.
2. PET 기존 운영 데이터는 검증 완료 전까지 삭제하지 않는다.
3. PET의 별도 `profiles` / `user_identities`는 최종 DB로 복사하지 않는다.
4. 통합 계정 기준은 Meeting의 `profiles.id`와 `profiles.member_id`다.
5. 기존 PET 계정과 Meeting 계정의 매핑 기준은 `meeting_member_links.external_member_id = meeting profiles.member_id`다.
6. 데이터 이관은 복사 → 검증 → dual-read/bridge → local 전환 → 기존 서비스 종료 순서로 진행한다.
7. PET UI와 API는 모임 프로젝트 내부 전용 모듈로 분리한다.
8. 기존 참석 보상 Outbox의 중복 방지 의미는 유지한다.

---

## 현재 연결 구조

```
Meeting profiles.member_id
        │
        ▼
Meeting /api/pet/*
        │ server-to-server
        ▼
jjinchin-pet /api/integration/meeting/*
        │
        ▼
meeting_member_links.external_member_id
        │
        ▼
PET profile_id
        │
        ├─ pets
        ├─ wallet
        ├─ inventory
        ├─ missions
        └─ achievements
```

이 구조는 **이관 기간의 임시 Bridge**로만 사용한다.

---

# 단계별 통합

## STEP 32.0 — Bridge 및 이관 기반

현재 완료/진행:

- Meeting 로그인 사용자 기반 PET summary proxy
- PET 서버의 Meeting summary endpoint
- PET 데이터/계정 매핑 구조 조사
- 타로 작업과 코드 경계 분리
- 완전 통합 migration 설계

이 단계에서는 운영 UI를 변경하지 않는다.

---

## STEP 32.1 — Meeting 내부 PET 모듈 생성

Meeting 저장소에 아래 구조를 생성한다.

```
components/pet/
lib/pet/
app/api/pet/
```

PET 관련 타입, API client, 상태 모델을 이 경계 안에 둔다.

초기에는 기존 PET 서버 Bridge를 사용하지만
UI는 이미 Meeting 코드베이스 안에서 렌더링되도록 만든다.

---

## STEP 32.2 — Target PET DB Schema 생성

Meeting Supabase 안에 PET 테이블을 만든다.

그대로 유지 가능한 주요 테이블:

- pet_species
- pets
- pet_action_types
- pet_actions
- pet_action_cooldowns
- items
- inventories
- pet_equipped_items
- missions
- mission_progress
- wallets
- wallet_transactions
- pet_share_profiles
- pet_visits
- pet_friends
- meeting_attendance_rewards
- pet_action_milestone_rewards
- pet_action_milestone_claims
- meeting_box_drop_items
- achievement_reward_claims
- pet_daily_checkins

### 복사하지 않는 테이블

- PET `profiles`
- PET `user_identities`
- 최종적으로 필요 없게 되는 `meeting_member_links`

PET의 모든 `profile_id / owner_id`는 Meeting `profiles.id`를 참조하도록 재설계한다.

---

## STEP 32.3 — 계정 ID Mapping

기존 PET 데이터를 옮길 때 핵심 매핑:

```
PET meeting_member_links.external_member_id
          =
Meeting profiles.member_id
```

따라서:

```
old PET profile_id
        ↓ meeting_member_links
external_member_id
        ↓ Meeting profiles.member_id
new Meeting profiles.id
```

을 만들어 모든 PET 소유 데이터를 변환한다.

매핑되지 않은 PET 계정은 자동 삭제하지 않고 migration exception 목록으로 남긴다.

---

## STEP 32.4 — 데이터 복사 및 검증

이관 순서:

1. 정적 master 데이터
   - pet_species
   - pet_action_types
   - items
   - missions

2. 사용자 PET 데이터
   - pets
   - wallets

3. 종속 데이터
   - pet_actions
   - cooldowns
   - inventories
   - equipped items
   - mission progress
   - share profiles
   - friends
   - achievements
   - daily checkins
   - meeting rewards

검증 항목:

- PET 수
- 회원별 PET 1:1 매핑
- Coin 총합
- inventory 수량 총합
- action count
- meeting reward count
- achievement claim count
- friend relation count
- orphan FK 0건

---

## STEP 32.5 — Local PET API 전환

기존:

```
Meeting API → jjinchin-pet API → PET DB
```

에서:

```
Meeting API → Meeting Supabase
```

로 전환한다.

Bridge와 Local 구현은 잠시 병존시켜 롤백 가능하게 유지한다.

---

## STEP 32.6 — PET UI 통합

최신 모임페이지와 타로 UI 변경을 다시 읽은 뒤,
그 시점의 구조에 맞춰 PET 진입점을 추가한다.

초기 UI:

- PET Hero
- Lv / EXP / 친밀도
- 포만감 / 행복 / 에너지
- PET Coin
- 출석
- 밥주기 / 놀기 / 산책 / 재우기

후속:

- 인벤토리
- 상점
- 성장도감
- 업적
- 친구 PET

---

## STEP 32.7 — 모임 데이터와 직접 결합

DB가 하나가 되면 기존 서버간 참석보상 요청을 제거하고
Meeting DB transaction/RPC 안에서 PET 보상을 처리한다.

목표:

```
attendance 등록
   ↓
PET reward RPC
   ↓
EXP / 친밀도 / Coin / 모임상자
```

기존 Outbox는 이관 기간 동안 유지하고,
완전 로컬화 후 필요 여부를 다시 판단한다.

---

## STEP 33 — 기존 jjinchin-pet 종료

종료 조건:

- 모든 연결 회원 데이터 migration 완료
- PET action 정상
- Coin 정상
- inventory 정상
- attendance reward 정상
- check-in 정상
- achievements 정상
- friends 정상
- 카카오 공유 정상
- 최소 1회 운영 백업 확보
- rollback 검증 완료

이후:

1. PET 신규 데이터 쓰기 중단
2. `jjinchin-pet` read-only 또는 안내 페이지 전환
3. 통합 Meeting PET을 기본 서비스로 전환
4. 안정화 후 별도 Vercel 프로젝트/Supabase 제거 여부 결정

---

## Rollback

완전 전환 전에는 기존 PET DB를 삭제하지 않는다.

문제가 생기면:

```
local PET backend OFF
→ Bridge backend ON
→ 기존 jjinchin-pet 데이터 사용
```

으로 복구 가능해야 한다.
