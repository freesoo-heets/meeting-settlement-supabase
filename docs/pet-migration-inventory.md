# PET → Meeting 데이터 이관 인벤토리

## 계정 기준

최종 계정 원본은 Meeting Supabase의 `profiles`다.

| PET source | Meeting target | 처리 |
|---|---|---|
| profiles | profiles | 복사 금지 |
| user_identities | Supabase Auth / profiles | 복사 금지 |
| meeting_member_links | migration mapping only | 최종 제거 대상 |

## 데이터 테이블

| Source table | Target | Owner/Profile 재매핑 |
|---|---|---|
| pet_species | pet_species | 없음 |
| pets | pets | owner_id → Meeting profiles.id |
| pet_action_types | pet_action_types | 없음 |
| pet_actions | pet_actions | profile_id → Meeting profiles.id |
| pet_action_cooldowns | pet_action_cooldowns | pet_id 유지/변환 |
| items | items | 없음 |
| inventories | inventories | profile_id → Meeting profiles.id |
| pet_equipped_items | pet_equipped_items | pet_id 유지/변환 |
| missions | missions | 없음 |
| mission_progress | mission_progress | profile_id → Meeting profiles.id |
| wallets | wallets | profile_id → Meeting profiles.id |
| wallet_transactions | wallet_transactions | profile_id → Meeting profiles.id |
| pet_share_profiles | pet_share_profiles | profile_id/pet_id 재매핑 |
| pet_visits | pet_visits | visitor/profile 관계 재매핑 |
| pet_friends | pet_friends | 양쪽 profile id 재매핑 |
| meeting_attendance_rewards | meeting_attendance_rewards | profile_id → Meeting profiles.id |
| pet_action_milestone_rewards | 동일 | master data |
| pet_action_milestone_claims | 동일 | profile/pet 재매핑 |
| meeting_box_drop_items | 동일 | item id 유지/변환 |
| achievement_reward_claims | 동일 | profile/pet 재매핑 |
| pet_daily_checkins | 동일 | profile/pet 재매핑 |

## ID 정책

가능하면 PET master/entity UUID를 그대로 유지한다.

유지 우선:

- pet_species.id
- pet_action_types.id
- items.id
- missions.id
- pets.id

PET profile UUID는 유지하지 않는다.

모든 사용자 소유 데이터는 아래 mapping table을 migration 시 임시 생성해서 변환한다.

```
old_pet_profile_id
meeting_member_id
new_meeting_profile_id
migration_status
```

## Preflight 필수 검증

- PET link가 없는 profile 수
- Meeting profile이 없는 external_member_id 수
- 한 Meeting member에 두 PET profile이 연결된 경우 0
- 한 PET profile이 두 member에 연결된 경우 0
- pet 없는 PET profile
- orphan inventory
- orphan wallet
- orphan friend relation

예외 데이터는 자동 삭제하지 않는다.

## Cutover 검증 지표

Source/Target 양쪽에서 비교:

- pets COUNT
- SUM(wallet.balance)
- inventories SUM(quantity)
- pet_actions COUNT
- meeting_attendance_rewards COUNT
- achievement_reward_claims COUNT
- pet_daily_checkins COUNT
- pet_friends COUNT

수치가 다르면 Local backend를 활성화하지 않는다.
