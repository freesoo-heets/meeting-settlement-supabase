
-- STEP 32.2b: Cover PET foreign keys before migration/load.
create index idx_pets_species on public.pets(species_id);
create index idx_pet_actions_action_type on public.pet_actions(action_type_id);
create index idx_pet_action_cooldowns_action_type on public.pet_action_cooldowns(action_type_id);
create index idx_inventories_item on public.inventories(item_id);
create index idx_pet_equipped_items_item on public.pet_equipped_items(item_id);
create index idx_mission_progress_mission on public.mission_progress(mission_id);
create index idx_meeting_attendance_rewards_pet on public.meeting_attendance_rewards(pet_id);
create index idx_pet_action_milestone_rewards_item on public.pet_action_milestone_rewards(item_id);
create index idx_pet_action_milestone_claims_pet on public.pet_action_milestone_claims(pet_id);
create index idx_pet_action_milestone_claims_reward on public.pet_action_milestone_claims(reward_id);
create index idx_pet_action_combo_rewards_item on public.pet_action_combo_rewards(item_id);
create index idx_pet_action_combo_claims_pet on public.pet_action_combo_claims(pet_id);
create index idx_pet_action_combo_claims_reward on public.pet_action_combo_claims(combo_reward_id);
create index idx_achievement_reward_claims_pet on public.achievement_reward_claims(pet_id);
create index idx_achievement_reward_claims_item on public.achievement_reward_claims(item_id) where item_id is not null;
create index idx_pet_daily_checkins_pet on public.pet_daily_checkins(pet_id);
create index idx_pet_daily_checkins_item on public.pet_daily_checkins(item_id) where item_id is not null;
