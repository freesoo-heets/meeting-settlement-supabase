-- 단어게임 🆘 도움! 알림 (bot_announcements 에 kind 'word' 허용)
alter table public.bot_announcements drop constraint if exists bot_announcements_kind_check;
alter table public.bot_announcements add constraint bot_announcements_kind_check
  check (kind in ('omok', 'alkkagi', 'holdem', 'word'));
