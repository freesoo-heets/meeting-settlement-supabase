-- 회원현황: 마지막 채팅 시각 + 최근 채팅 내역 (카톡 봇이 올린다)
-- 채팅 내용은 민감하므로 화면에서 직접 읽지 못하게 한다(정책 없음).
-- 서버(/api/chatlog)가 운영진 · 본인에게만 내려준다.
create table if not exists public.member_chat (
  kakao_uid    text primary key,
  name         text not null,          -- 짧은 닉네임 (사이트 회원 이름과 맞춤)
  full_nick    text,
  last_chat_at timestamptz,            -- !유령 과 같은 기준 (명령어 포함)
  messages     jsonb not null default '[]'::jsonb,   -- [{t: '26/10/07 14:03:11', m: '...'}] 최근 것이 뒤
  synced_at    timestamptz not null default now()
);
create index if not exists member_chat_name_idx on public.member_chat (name);
alter table public.member_chat enable row level security;
