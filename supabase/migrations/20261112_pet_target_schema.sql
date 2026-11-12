-- STEP 32.2: PET target schema inside meeting-settlement-supabase.
-- Additive only. PET source auth/profile tables are intentionally NOT copied.
-- All PET ownership points directly to existing public.profiles(id).

create table public.pet_species (
  id uuid primary key default gen_random_uuid(),
  code varchar not null unique,
  name varchar not null,
  description text,
  base_image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  species_id uuid not null references public.pet_species(id),
  name varchar not null check (char_length(name) between 1 and 20),
  level integer not null default 1 check (level between 1 and 50),
  exp integer not null default 0 check (exp >= 0),
  hunger numeric not null default 80 check (hunger between 0 and 100),
  happiness numeric not null default 80 check (happiness between 0 and 100),
  energy numeric not null default 100 check (energy between 0 and 100),
  affection integer not null default 0 check (affection >= 0),
  evolution_stage integer not null default 0 check (evolution_stage >= 0),
  last_status_calculated_at timestamptz not null default now(),
  born_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_pets_owner_v1 unique (owner_id)
);
create index idx_pets_owner on public.pets(owner_id);

create table public.pet_action_types (
  id uuid primary key default gen_random_uuid(),
  code varchar not null unique,
  name varchar not null,
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  hunger_change integer not null default 0,
  happiness_change integer not null default 0,
  energy_change integer not null default 0,
  exp_reward integer not null default 0 check (exp_reward >= 0),
  affection_reward integer not null default 0 check (affection_reward >= 0),
  coin_reward integer not null default 0 check (coin_reward >= 0),
  is_active boolean not null default true
);

create table public.pet_actions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  action_type_id uuid not null references public.pet_action_types(id),
  exp_earned integer not null default 0,
  affection_earned integer not null default 0,
  coin_earned integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_pet_actions_pet_date on public.pet_actions(pet_id, created_at desc);
create index idx_pet_actions_profile_date on public.pet_actions(profile_id, created_at desc);

create table public.pet_action_cooldowns (
  pet_id uuid not null references public.pets(id) on delete cascade,
  action_type_id uuid not null references public.pet_action_types(id) on delete cascade,
  available_at timestamptz not null,
  primary key (pet_id, action_type_id)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  code varchar not null unique,
  name varchar not null,
  category varchar not null check (category in ('food','toy','cosmetic','special')),
  description text,
  price integer not null default 0 check (price >= 0),
  effects jsonb not null default '{}'::jsonb,
  image_url text,
  equip_slot varchar check (equip_slot is null or equip_slot in ('HEAD','FACE','NECK','BODY')),
  is_sellable boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inventories (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

create table public.pet_equipped_items (
  pet_id uuid not null references public.pets(id) on delete cascade,
  slot varchar not null check (slot in ('HEAD','FACE','NECK','BODY')),
  item_id uuid not null references public.items(id),
  equipped_at timestamptz not null default now(),
  primary key (pet_id, slot)
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  code varchar not null unique,
  name varchar not null,
  mission_type varchar not null,
  target_value integer not null check (target_value > 0),
  reward_coin integer not null default 0 check (reward_coin >= 0),
  reward_exp integer not null default 0 check (reward_exp >= 0),
  is_daily boolean not null default true,
  is_active boolean not null default true
);

create table public.mission_progress (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  mission_date date not null,
  progress integer not null default 0 check (progress >= 0),
  completed boolean not null default false,
  reward_claimed boolean not null default false,
  completed_at timestamptz,
  unique (profile_id, mission_id, mission_date)
);
create index idx_mission_progress_profile on public.mission_progress(profile_id, mission_date desc);

create table public.wallets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  transaction_type varchar not null,
  reference_type varchar,
  reference_id uuid,
  balance_after bigint check (balance_after is null or balance_after >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_wallet_transactions_profile on public.wallet_transactions(profile_id, created_at desc);
create unique index uq_wallet_transactions_reward_source
  on public.wallet_transactions(transaction_type, reference_type, reference_id)
  where reference_id is not null;

create table public.pet_share_profiles (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  public_code varchar not null unique,
  is_public boolean not null default true,
  allow_visit boolean not null default true,
  allow_treat boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pet_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_profile_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  action varchar not null default 'PET' check (action in ('PET','TREAT')),
  visit_date date not null default (timezone('Asia/Seoul', now()))::date,
  reward_coin integer not null default 0 check (reward_coin >= 0),
  created_at timestamptz not null default now(),
  action_type varchar not null default 'PET',
  unique (visitor_profile_id, pet_id, action, visit_date)
);
create index idx_pet_visits_pet_date on public.pet_visits(pet_id, visit_date desc);
create unique index uq_pet_visits_daily_pet
  on public.pet_visits(visitor_profile_id, pet_id, visit_date, action_type);

create table public.pet_friends (
  id uuid primary key default gen_random_uuid(),
  profile_id_a uuid not null references public.profiles(id) on delete cascade,
  profile_id_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint pet_friends_no_self check (profile_id_a <> profile_id_b),
  constraint pet_friends_unique_pair unique (profile_id_a, profile_id_b)
);
create index idx_pet_friends_profile_a on public.pet_friends(profile_id_a);
create index idx_pet_friends_profile_b on public.pet_friends(profile_id_b);

create table public.meeting_attendance_rewards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  external_event_id varchar not null unique,
  meeting_name varchar,
  exp_reward integer not null default 50,
  affection_reward integer not null default 10,
  coin_reward bigint not null default 100,
  box_quantity integer not null default 1,
  level_before integer not null,
  level_after integer not null,
  exp_before integer not null,
  exp_after integer not null,
  levels_gained integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_meeting_attendance_rewards_profile
  on public.meeting_attendance_rewards(profile_id, created_at desc);

create table public.pet_action_milestone_rewards (
  id uuid primary key default gen_random_uuid(),
  action_code varchar not null,
  required_count integer not null check (required_count > 0),
  item_id uuid not null references public.items(id),
  quantity integer not null default 1 check (quantity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (action_code, required_count, item_id)
);
create index pet_action_milestone_rewards_action_idx
  on public.pet_action_milestone_rewards(action_code, required_count)
  where is_active = true;

create table public.pet_action_milestone_claims (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  reward_id uuid not null references public.pet_action_milestone_rewards(id),
  action_count integer not null,
  created_at timestamptz not null default now(),
  unique (profile_id, reward_id)
);
create index pet_action_milestone_claims_profile_idx
  on public.pet_action_milestone_claims(profile_id, created_at desc);

create table public.meeting_box_drop_items (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.items(id),
  weight integer not null check (weight > 0),
  min_quantity integer not null default 1 check (min_quantity > 0),
  max_quantity integer not null default 1 check (max_quantity >= min_quantity),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pet_action_combo_rewards (
  id uuid primary key default gen_random_uuid(),
  code varchar not null unique,
  name varchar not null,
  item_id uuid not null references public.items(id),
  quantity integer not null default 1 check (quantity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pet_action_combo_conditions (
  id uuid primary key default gen_random_uuid(),
  combo_reward_id uuid not null references public.pet_action_combo_rewards(id) on delete cascade,
  action_code varchar not null,
  required_count integer not null check (required_count > 0),
  created_at timestamptz not null default now(),
  unique (combo_reward_id, action_code)
);

create table public.pet_action_combo_claims (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  combo_reward_id uuid not null references public.pet_action_combo_rewards(id),
  created_at timestamptz not null default now(),
  unique (profile_id, pet_id, combo_reward_id)
);

create table public.achievement_reward_claims (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  badge_code varchar not null,
  coin_reward bigint not null default 0 check (coin_reward >= 0),
  item_id uuid references public.items(id),
  item_quantity integer not null default 0 check (item_quantity >= 0),
  created_at timestamptz not null default now(),
  unique (profile_id, badge_code)
);
create index idx_achievement_reward_claims_profile
  on public.achievement_reward_claims(profile_id, created_at desc);

create table public.pet_daily_checkins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  checkin_date date not null,
  streak integer not null check (streak >= 1),
  cycle_day integer not null check (cycle_day between 1 and 7),
  coin_reward bigint not null default 0 check (coin_reward >= 0),
  item_id uuid references public.items(id),
  item_quantity integer not null default 0 check (item_quantity >= 0),
  created_at timestamptz not null default now(),
  unique (profile_id, checkin_date)
);
create index idx_pet_daily_checkins_profile_date
  on public.pet_daily_checkins(profile_id, checkin_date desc);

alter table public.pet_species enable row level security;
alter table public.pets enable row level security;
alter table public.pet_action_types enable row level security;
alter table public.pet_actions enable row level security;
alter table public.pet_action_cooldowns enable row level security;
alter table public.items enable row level security;
alter table public.inventories enable row level security;
alter table public.pet_equipped_items enable row level security;
alter table public.missions enable row level security;
alter table public.mission_progress enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.pet_share_profiles enable row level security;
alter table public.pet_visits enable row level security;
alter table public.pet_friends enable row level security;
alter table public.meeting_attendance_rewards enable row level security;
alter table public.pet_action_milestone_rewards enable row level security;
alter table public.pet_action_milestone_claims enable row level security;
alter table public.meeting_box_drop_items enable row level security;
alter table public.pet_action_combo_rewards enable row level security;
alter table public.pet_action_combo_conditions enable row level security;
alter table public.pet_action_combo_claims enable row level security;
alter table public.achievement_reward_claims enable row level security;
alter table public.pet_daily_checkins enable row level security;

revoke all on public.pet_species from anon, authenticated;
revoke all on public.pets from anon, authenticated;
revoke all on public.pet_action_types from anon, authenticated;
revoke all on public.pet_actions from anon, authenticated;
revoke all on public.pet_action_cooldowns from anon, authenticated;
revoke all on public.items from anon, authenticated;
revoke all on public.inventories from anon, authenticated;
revoke all on public.pet_equipped_items from anon, authenticated;
revoke all on public.missions from anon, authenticated;
revoke all on public.mission_progress from anon, authenticated;
revoke all on public.wallets from anon, authenticated;
revoke all on public.wallet_transactions from anon, authenticated;
revoke all on public.pet_share_profiles from anon, authenticated;
revoke all on public.pet_visits from anon, authenticated;
revoke all on public.pet_friends from anon, authenticated;
revoke all on public.meeting_attendance_rewards from anon, authenticated;
revoke all on public.pet_action_milestone_rewards from anon, authenticated;
revoke all on public.pet_action_milestone_claims from anon, authenticated;
revoke all on public.meeting_box_drop_items from anon, authenticated;
revoke all on public.pet_action_combo_rewards from anon, authenticated;
revoke all on public.pet_action_combo_conditions from anon, authenticated;
revoke all on public.pet_action_combo_claims from anon, authenticated;
revoke all on public.achievement_reward_claims from anon, authenticated;
revoke all on public.pet_daily_checkins from anon, authenticated;

comment on table public.pets is 'STEP 32.2: PET ownership uses Meeting public.profiles.id directly.';
comment on table public.wallets is 'STEP 32.2: PET Coin wallet keyed by Meeting public.profiles.id.';
comment on table public.meeting_attendance_rewards is 'STEP 32.2: Target ledger for PET rewards after bridge-to-local cutover.';
