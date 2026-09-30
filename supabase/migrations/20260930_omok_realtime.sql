-- 오목 착수를 상대 화면에 바로 보내기 위한 실시간 구독 허용
-- (읽기 권한은 기존 RLS 정책 그대로: 로그인한 회원만)
alter publication supabase_realtime add table public.omok_games;
