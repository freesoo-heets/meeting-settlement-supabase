-- 오목 무르기 요청 상태 {pending: {by, n} | null, used: {host, guest}}
alter table public.omok_games add column if not exists undo jsonb not null default '{}'::jsonb;
