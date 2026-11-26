-- Registry of admins confirmed by the running admin_helper.py on an actual Kakao chat event.
-- This does not edit the bot's own administrator registry. The bot is the authority.
create table if not exists public.jjinchin_feedback_verified_bot_admins(
 profile_id uuid primary key references public.profiles(id) on delete cascade,
 kakao_uid text not null unique check (length(kakao_uid) between 1 and 256),
 nickname_at_verification text not null,
 verified_at timestamptz not null default now()
);
create index if not exists feedback_verified_admins_fresh
 on public.jjinchin_feedback_verified_bot_admins(verified_at desc);
alter table public.jjinchin_feedback_verified_bot_admins enable row level security;
revoke all on public.jjinchin_feedback_verified_bot_admins from public,anon,authenticated;
grant select,insert,update,delete on public.jjinchin_feedback_verified_bot_admins to service_role;

-- Do not create a privileged public function: account resolution and per-message
-- admin_helper.is_admin(chat=chat) are checked inside the trusted operating bot.
