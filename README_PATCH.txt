모바일 하단 네비게이션 오류 수정

원인: 홈/모임/회원 버튼이 공통 map 안에서 setShowAccountPanel(true)를 실행하도록 PET 연동 작업 중 잘못 변경됨.
수정: 홈/모임/회원 버튼은 setMainTab(value)로 정상 탭 전환. 내 계정 버튼의 PET 연동 로직은 유지.
DB/SQL/환경변수 변경 없음.
