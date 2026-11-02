// 봇관리 목록의 파일 설명. 새 파일은 여기에 없으면 설명 없이 보인다
//  · "미사용" = 봇(irispy.py)이 불러오지 않는 파일 · "시험용" = 불러오지만 진단 · 시험 명령만 있는 파일

export const BOT_SCRIPT_INFO: Record<string, string> = {
  "irispy.py": "봇 본체. 메시지를 받아 각 기능으로 넘기고 연동을 시작 (새 파일은 여기에 연결)",

  // 게임 · 점수
  "point_helper.py": "점수판 · 랭킹 · 메달 · 시즌 초기화 (!내점수 !랭킹)",
  "ticket_helper.py": "티켓 지급 · 사용 전담",
  "point_admin.py": "사이트 ⚙️ 점수 · 티켓 · 메달 요청 반영 · 📜 점수 내역을 사이트로",
  "attendance_helper.py": "출석 · 경마 베팅 (!출석 !ㅊㅊ !경마베팅)",
  "quiz_helper.py": "자음퀴즈 · 상식퀴즈 (!자음퀴즈 !상식퀴즈)",
  "song_quiz_helper.py": "노래 맞추기 (!노래퀴즈 !노래힌트)",
  "updown_helper.py": "업다운 게임 (!업다운)",
  "wordle_helper.py": "오늘의 단어 카톡 게임 · 단어장 (!단어 !단어추가 !단어삭제)",
  "game_champions.py": "사이트 게임 이번 달 1등 메달 (오목 · 알까기 · 캐치마인드)",

  // 사이트 게임 연동
  "omok_bridge.py": "사이트 오목 · 알까기 · 캐치마인드 ↔ 점수판 연동 (!오목 !알까기 !전적)",
  "holdem_bridge.py": "사이트 홀덤 ↔ 점수판 연동 (!홀덤)",
  "word_bridge.py": "사이트 단어게임 ↔ 카톡 연동 · 단어 AI 검증 · 삭제 요청 처리",

  // 모임 · 사이트 연동
  "schedule_helper.py": "카톡 일정 목록 · 참석자 표시 (!일정)",
  "meeting_sync.py": "카톡 일정 → 사이트 벙 자동 등록 (!일정올리기)",
  "meeting_stats.py": "벙 참여 현황 · 모임 랭킹 (!벙참여 !모임랭킹)",
  "meeting_settlement.py": "벙비 입력 · 정산, 운영진방 전용 (!비용 !정산)",
  "meeting_host_points.py": "벙주 포인트 지급 (!벙포 !벙주지급)",
  "member_sync.py": "카톡방 입퇴장 → 사이트 회원 자동 반영 (!회원대조)",
  "point_sync.py": "점수판 → 사이트 회원 현황 반영 (!점수올리기)",
  "chat_sync.py": "카톡 활동 · 채팅 기록 → 사이트 회원 현황 반영",
  "attendance_notice.py": "참석 경고 대상 매일 10시 자동 안내",

  // 채팅 · 관리
  "ai_helper.py": "푸들봇 AI 대화 · 대화 요약 (!요약)",
  "chat_helper.py": "채팅 순위 · 통계 (!채팅순위 !채팅통계)",
  "chat_history_helper.py": "대화 기록 조회 (!채팅기록)",
  "ghost_helper.py": "오래 활동 없는 회원 확인 (!유령)",
  "monitor_helper.py": "닉네임 변경 감지 · 메시지 가리기 · 방 확인 (!가리기 !방확인)",
  "user_helper.py": "회원 ID ↔ 닉네임 관리 (!매핑현황 !유저정리)",
  "room_thread_helper.py": "방 스레드 등록 · 연결 (!방등록 !방목록)",
  "learn_helper.py": "키워드 학습 답변 (!학습 !학습목록)",
  "mbti_helper.py": "MBTI 기록 (!mbti)",
  "daily_helper.py": "도움말 · 생활 정보 명령 모음 (!관리자도움말)",
  "finance_helper.py": "환율 · 관심종목 (!USD !관심종목)",
  "migrate_helper.py": "닉네임 기록 → 회원 ID 데이터 이관 (!이관실행)",

  // 시험 · 진단
  "media_test.py": "시험용 · 미디어 전송 시험 (!미디어테스트)",
  "reply_diagnostic.py": "시험용 · 답장 · API 구조 진단 (!답장분석 !api구조)",

  // 봇이 불러오지 않는 파일
  "coin.py": "미사용 · 코인 시세 · 김프 (!코인)",
  "swear_helper.py": "미사용 · 욕설 집계 (!욕설순위)",
  "schedule_sync.py": "미사용 · 일정 올리기 예전 파일 (지금은 meeting_sync.py)",
  "schedule_dump.py": "미사용 · 카톡 일정 원문 확인 (!일정덤프)",
  "del_bot.py": "미사용 · 메시지 삭제 감지 시험",
  "audio_research.py": "미사용 · 음성메시지 형식 시험",
  "media_send_test.py": "미사용 · 영상 · 음성 전송 시험",
  "logid_test.py": "미사용 · 카톡 메시지 ID 확인",
};
