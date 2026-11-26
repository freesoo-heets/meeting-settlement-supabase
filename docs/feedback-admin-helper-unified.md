# 소리함 관리자 통합 — irispy.py 운영 연동

현재 GitHub main에는 운영 봇 실제 `irispy.py` 파일이 없고, Supabase `bot_scripts`가 실행본을 관리합니다.
**기존 전체 봇을 덮어쓰지 않고 다음 두 위치에만 반영합니다.**

1. `admin_helper.ensure_admin_room_member(chat)` 호출을 유지한 뒤, 운영진방 메시지에서 소리함 관리자 인증 정보를 동기화합니다.
   ```python
   if room_id == ADMIN_ROOM_ID:
       try:
           import feedback_helper
           feedback_helper.observe_admin(chat)
       except Exception as exc:
           print("[소리함 관리자 동기화]", type(exc).__name__, flush=True)
   ```
2. 기존 소리함 명령 분기 목록에 `!소리연결`, `!소리인증`, `!소리관리자`를 추가합니다.
   ```python
   if command in ("!소리", "!소리목록", "!소리도움", "!소리내역", "!답변", "!검토", "!완료",
                  "!소리연결", "!소리인증", "!소리관리자"):
       try:
           import feedback_helper
           if feedback_helper.handle(chat, command, arg):
               return
       except Exception as exc:
           print("[소리함] 명령 처리 오류:", type(exc).__name__, flush=True)
           return
   ```

### 권한 모델
- **관리자 후보 인증**: 봇이 실제 `admin_helper.is_admin(chat=chat)`을 통과한 운영진방 발신 ID만 등록
- **본인 인증**: `!소리인증`, 실제 Kakao ID와 계정 매핑이 일치해야만 웹 후보로 등장
- **담당 지정/해제**: 방장만 운영진방에서 `!소리관리자 지정 닉네임`, `!소리관리자 해제 닉네임`
- **목록**: `!소리관리자 목록` (방장 전용)
- **웹 관리**: 소리함 담당자 체크박스는 동일한 `jjinchin_feedback_reviewers` 테이블을 수정
- **유효기간**: 실제 admin_helper 인증 최근 7일 내 기록을 사용. 관리자 방에서 메시지를 보내면 갱신(10분 DB 쓰기 제한). 관리자 자격 상실 후 해당 사용자가 메시지를 보내면 바로 등록 해제
- **보안 한계**: admin_helper의 전체 파일/등록 목록을 DB에서 직접 읽는 기능은 기존에 없으므로, 아무 메시지도 보내지 않은 관리자까지 자동 조회하지는 못함. 각 운영진이 `!소리인증`을 한 번 실행해야 웹 후보에 반영됨
- **기존 봇 관리자 목록은 수정하지 않음**. 프로필 `role`을 강제 변경하지 않음
