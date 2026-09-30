-- 캐치마인드 모집 알림 (방 생성 · '모집하기' 버튼 → 봇이 카톡방에 알림)
alter table public.catch_rooms add column if not exists recruit_at timestamptz;
alter table public.catch_rooms add column if not exists recruit_no integer not null default 0;
