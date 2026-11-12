
-- STEP 32.3: PET source-profile -> Meeting profile migration map.
-- Existing PET meeting_member_links are confirmed. Exact nickname matches are candidates only.
create table public.pet_migration_profile_map (
  old_pet_profile_id uuid primary key,
  meeting_member_id uuid not null references public.members(id),
  new_meeting_profile_id uuid not null references public.profiles(id),
  source_nickname text not null,
  match_method text not null check (match_method in ('existing_link','nickname_exact','manual')),
  migration_status text not null check (migration_status in ('confirmed','candidate','rejected','migrated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_member_id),
  unique (new_meeting_profile_id)
);
alter table public.pet_migration_profile_map enable row level security;
revoke all on public.pet_migration_profile_map from anon, authenticated;

insert into public.pet_migration_profile_map
(old_pet_profile_id, meeting_member_id, new_meeting_profile_id, source_nickname, match_method, migration_status)
values
('cc44f22b-d078-4135-af73-3d0a765bf84a','20224c01-c11e-41ec-9fc4-a2e2f27e23b4','71a2447f-ac2a-4cab-a6c9-46a7409545c6','퐁당','existing_link','confirmed'),
('b890a4d3-3071-472b-a5fc-58ee1f86d039','a92d077a-b7b4-4de4-aee0-89ef01b048e1','fba3247e-8052-4f6b-ab36-72f168bee381','푸들','existing_link','confirmed'),
('50848854-0f0d-42a4-a0ca-2f312ea72d06','3679424f-c842-4876-bcdc-ff8af476640b','8f89c44e-5755-4dc3-976b-40a49319f0d9','하얀','nickname_exact','candidate'),
('a453a4d3-96f4-40a4-a452-5773cf459cfd','fcf2ca7c-b638-4bdb-a868-a4f7c12e6798','f1c47a43-33a8-4389-b49d-accb075b745a','은행','nickname_exact','candidate'),
('ed6e0dc8-2f47-4cf6-b34f-589af9b1c1b6','4a10cc0c-12c9-46b7-a699-628861dab1af','a77abd2f-1bc6-487c-956d-76dbd51a48b4','누룽','nickname_exact','candidate'),
('108ecd53-8a76-47f3-aa12-b428f322623b','3131901b-7540-4536-aa4d-4bde5e5ab1f7','fe66d2fa-d4bf-4cdb-bbe8-913d8ddf6494','채채','nickname_exact','candidate'),
('3ceec8ac-adbf-40af-8ebe-f3d22f5d7e2a','5171c8b8-99ce-4496-89d1-7b092dc34d5e','0c24c9ac-fac5-4aa0-b66a-a5eaf454d1af','옥현','nickname_exact','candidate'),
('e1240681-45bf-4e87-95fc-76293545dd68','e9cc208b-efcb-40b0-9121-060444d96d49','b57111d9-ca1b-457c-836f-ce28a2022e08','흐이','nickname_exact','candidate'),
('7286b00f-482f-4813-b32a-99beeb85915f','e3245fcf-2af0-4e3e-a3c5-12d51ebcb43a','e5ff804f-1a1f-4c18-bd91-3654e500d8fe','밤짱','nickname_exact','candidate');

comment on table public.pet_migration_profile_map is
'STEP 32.3 temporary migration map. candidate rows must be confirmed before user PET data cutover.';
