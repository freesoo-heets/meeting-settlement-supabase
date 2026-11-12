
-- STEP 32.4b: mark only previously confirmed permanent PET links as migrated.
-- Nickname-only candidates remain candidates until explicitly confirmed.
update public.pet_migration_profile_map
set migration_status = 'migrated',
    updated_at = now()
where migration_status = 'confirmed'
  and match_method = 'existing_link';
