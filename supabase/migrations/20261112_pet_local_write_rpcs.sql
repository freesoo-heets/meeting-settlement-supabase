-- STEP 32.6: PET local write RPCs copied from verified legacy PetPRG definitions.
-- Server-only: browser roles cannot execute these functions.

CREATE OR REPLACE FUNCTION public.credit_wallet(p_profile_id uuid, p_amount bigint, p_transaction_type character varying, p_reference_type character varying DEFAULT NULL::character varying, p_reference_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(balance bigint, applied boolean, transaction_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tx_id uuid;
  v_balance bigint;
begin
  if p_profile_id is null then
    raise exception 'profile_id is required';
  end if;

  if p_amount <= 0 then
    raise exception 'credit amount must be greater than zero';
  end if;

  -- Ensure the wallet exists.
  insert into public.wallets(profile_id, balance)
  values (p_profile_id, 0)
  on conflict(profile_id) do nothing;

  -- If this reward has a stable source, reserve the ledger key first.
  -- Concurrent duplicate requests can only insert one row.
  if p_reference_id is not null then
    insert into public.wallet_transactions(
      profile_id,
      amount,
      transaction_type,
      reference_type,
      reference_id,
      balance_after,
      metadata
    )
    values (
      p_profile_id,
      p_amount,
      p_transaction_type,
      p_reference_type,
      p_reference_id,
      null,
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (transaction_type, reference_type, reference_id)
      where reference_id is not null
    do nothing
    returning id into v_tx_id;

    -- Duplicate reward: do not change the balance again.
    if v_tx_id is null then
      select wt.balance_after
        into v_balance
      from public.wallet_transactions wt
      where wt.transaction_type = p_transaction_type
        and wt.reference_type is not distinct from p_reference_type
        and wt.reference_id = p_reference_id
      limit 1;

      if v_balance is null then
        select w.balance into v_balance
        from public.wallets w
        where w.profile_id = p_profile_id;
      end if;

      return query select v_balance, false, null::uuid;
      return;
    end if;
  end if;

  -- Atomic increment. PostgreSQL row locking prevents lost updates.
  update public.wallets
  set balance = public.wallets.balance + p_amount
  where profile_id = p_profile_id
  returning public.wallets.balance into v_balance;

  if p_reference_id is null then
    insert into public.wallet_transactions(
      profile_id,
      amount,
      transaction_type,
      reference_type,
      reference_id,
      balance_after,
      metadata
    )
    values (
      p_profile_id,
      p_amount,
      p_transaction_type,
      p_reference_type,
      null,
      v_balance,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_tx_id;
  else
    update public.wallet_transactions
    set balance_after = v_balance
    where id = v_tx_id;
  end if;

  return query select v_balance, true, v_tx_id;
end;
$function$;

revoke all on function public.credit_wallet(uuid,bigint,varchar,varchar,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.credit_wallet(uuid,bigint,varchar,varchar,uuid,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.grant_pet_action_milestones(p_profile_id uuid, p_pet_id uuid, p_action_code text)
 RETURNS TABLE(reward_id uuid, required_count integer, item_id uuid, item_code text, item_name text, quantity integer, action_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_action_count integer;
  v_reward record;
  v_claim_id uuid;
begin
  -- PET 소유권 확인
  if not exists (
    select 1
    from public.pets p
    where p.id = p_pet_id
      and p.owner_id = p_profile_id
  ) then
    raise exception 'PET_NOT_OWNED';
  end if;

  -- 해당 행동의 실제 누적 횟수
  select count(*)::integer
  into v_action_count
  from public.pet_actions pa
  join public.pet_action_types pat
    on pat.id = pa.action_type_id
  where pa.profile_id = p_profile_id
    and pa.pet_id = p_pet_id
    and upper(pat.code) = upper(p_action_code);

  -- 달성한 미수령 마일스톤 처리
  for v_reward in
    select
      r.id as milestone_reward_id,
      r.required_count as milestone_required_count,
      r.item_id as milestone_item_id,
      r.quantity as milestone_quantity,
      i.code as milestone_item_code,
      i.name as milestone_item_name
    from public.pet_action_milestone_rewards r
    join public.items i
      on i.id = r.item_id
    where upper(r.action_code) = upper(p_action_code)
      and r.is_active = true
      and r.required_count <= v_action_count
      and not exists (
        select 1
        from public.pet_action_milestone_claims pc
        where pc.profile_id = p_profile_id
          and pc.pet_id = p_pet_id
          and pc.reward_id = r.id
      )
    order by r.required_count, r.id
  loop
    v_claim_id := null;

    insert into public.pet_action_milestone_claims
      (profile_id, pet_id, reward_id, action_count)
    values
      (
        p_profile_id,
        p_pet_id,
        v_reward.milestone_reward_id,
        v_action_count
      )
    on conflict (profile_id, reward_id)
    do nothing
    returning id into v_claim_id;

    if v_claim_id is not null then
      insert into public.inventories as inv
        (profile_id, item_id, quantity, updated_at)
      values
        (
          p_profile_id,
          v_reward.milestone_item_id,
          v_reward.milestone_quantity,
          now()
        )
      on conflict on constraint inventories_pkey
      do update set
        quantity = inv.quantity + excluded.quantity,
        updated_at = now();

      reward_id := v_reward.milestone_reward_id;
      required_count := v_reward.milestone_required_count;
      item_id := v_reward.milestone_item_id;
      item_code := v_reward.milestone_item_code;
      item_name := v_reward.milestone_item_name;
      quantity := v_reward.milestone_quantity;
      action_count := v_action_count;

      return next;
    end if;
  end loop;

  return;
end;
$function$;

revoke all on function public.grant_pet_action_milestones(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.grant_pet_action_milestones(uuid,uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.grant_pet_action_combo_rewards(p_profile_id uuid, p_pet_id uuid)
 RETURNS TABLE(combo_code text, combo_name text, item_id uuid, item_code text, item_name text, quantity integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_reward record;
  v_claim_id uuid;
begin
  if not exists (
    select 1 from public.pets p
    where p.id=p_pet_id and p.owner_id=p_profile_id
  ) then
    raise exception 'PET_NOT_OWNED';
  end if;

  for v_reward in
    select r.id, r.code, r.name, r.item_id, r.quantity,
           i.code as item_code, i.name as item_name
    from public.pet_action_combo_rewards r
    join public.items i on i.id=r.item_id
    where r.is_active=true
      and not exists (
        select 1
        from public.pet_action_combo_conditions c
        where c.combo_reward_id=r.id
          and (
            select count(*)::integer
            from public.pet_actions pa
            join public.pet_action_types pat on pat.id=pa.action_type_id
            where pa.profile_id=p_profile_id
              and pa.pet_id=p_pet_id
              and pat.code=c.action_code
          ) < c.required_count
      )
    order by r.created_at, r.id
  loop
    v_claim_id := null;

    insert into public.pet_action_combo_claims
      (profile_id,pet_id,combo_reward_id)
    values
      (p_profile_id,p_pet_id,v_reward.id)
    on conflict (profile_id,pet_id,combo_reward_id) do nothing
    returning id into v_claim_id;

    if v_claim_id is not null then
      insert into public.inventories as inv
        (profile_id,item_id,quantity,updated_at)
      values
        (p_profile_id,v_reward.item_id,v_reward.quantity,now())
      on conflict on constraint inventories_pkey
      do update set
        quantity=inv.quantity+excluded.quantity,
        updated_at=now();

      combo_code := v_reward.code;
      combo_name := v_reward.name;
      item_id := v_reward.item_id;
      item_code := v_reward.item_code;
      item_name := v_reward.item_name;
      quantity := v_reward.quantity;
      return next;
    end if;
  end loop;
end;
$function$;

revoke all on function public.grant_pet_action_combo_rewards(uuid,uuid) from public, anon, authenticated;
grant execute on function public.grant_pet_action_combo_rewards(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.perform_pet_action_atomic(p_profile_id uuid, p_pet_id uuid, p_action_code text, p_action_id uuid, p_expected_last_status_calculated_at timestamp with time zone, p_level integer, p_exp integer, p_hunger numeric, p_happiness numeric, p_energy numeric, p_affection integer, p_exp_earned integer, p_affection_earned integer, p_coin_earned integer, p_multiplier numeric, p_levels_gained integer, p_status_before jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pet public.pets%rowtype;
  v_action public.pet_action_types%rowtype;
  v_now timestamptz := now();
  v_available_at timestamptz;
  v_existing_available_at timestamptz;
  v_balance bigint := 0;
  v_wallet_result record;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_mission_type text;
  v_mission record;
  v_completed_count integer := 0;
  v_all record;
  v_milestones jsonb := '[]'::jsonb;
  v_combos jsonb := '[]'::jsonb;
begin
  if p_profile_id is null or p_pet_id is null or p_action_id is null then
    raise exception 'INVALID_REQUEST';
  end if;

  if upper(coalesce(p_action_code,'')) not in ('FEED','PLAY','WALK','SLEEP') then
    raise exception 'INVALID_ACTION';
  end if;

  -- Serialize all actions for this PET. This is the transaction boundary.
  select *
    into v_pet
  from public.pets p
  where p.id = p_pet_id
    and p.owner_id = p_profile_id
  for update;

  if not found then
    raise exception 'PET_NOT_FOUND';
  end if;

  select *
    into v_action
  from public.pet_action_types pat
  where upper(pat.code) = upper(p_action_code)
    and pat.is_active = true
  limit 1;

  if not found then
    raise exception 'ACTION_NOT_FOUND';
  end if;

  -- If state changed after the API calculated decay/rewards, reject instead of
  -- overwriting newer state. The API can safely ask the user to retry.
  if p_expected_last_status_calculated_at is not null
     and v_pet.last_status_calculated_at is distinct from p_expected_last_status_calculated_at then
    raise exception 'PET_STATE_CHANGED';
  end if;

  select pac.available_at
    into v_existing_available_at
  from public.pet_action_cooldowns pac
  where pac.pet_id = p_pet_id
    and pac.action_type_id = v_action.id
  for update;

  if v_existing_available_at is not null and v_existing_available_at > v_now then
    raise exception 'COOLDOWN|%', v_existing_available_at;
  end if;

  if p_level < 1 or p_level > 50
     or p_exp < 0
     or p_hunger < 0 or p_hunger > 100
     or p_happiness < 0 or p_happiness > 100
     or p_energy < 0 or p_energy > 100
     or p_affection < 0
     or p_exp_earned < 0
     or p_affection_earned < 0
     or p_coin_earned < 0
     or p_levels_gained < 0 then
    raise exception 'INVALID_RESULT';
  end if;

  -- A supplied action id is an idempotency key for the complete transaction.
  if exists(select 1 from public.pet_actions pa where pa.id = p_action_id) then
    raise exception 'ACTION_ALREADY_APPLIED';
  end if;

  update public.pets
  set level = p_level,
      exp = p_exp,
      hunger = p_hunger,
      happiness = p_happiness,
      energy = p_energy,
      affection = p_affection,
      last_status_calculated_at = v_now
  where id = p_pet_id
    and owner_id = p_profile_id;

  v_available_at := v_now + make_interval(secs => v_action.cooldown_seconds);

  insert into public.pet_action_cooldowns(pet_id, action_type_id, available_at)
  values(p_pet_id, v_action.id, v_available_at)
  on conflict(pet_id, action_type_id)
  do update set available_at = excluded.available_at;

  insert into public.pet_actions(
    id, pet_id, profile_id, action_type_id,
    exp_earned, affection_earned, coin_earned, metadata
  )
  values(
    p_action_id, p_pet_id, p_profile_id, v_action.id,
    p_exp_earned, p_affection_earned, p_coin_earned,
    jsonb_build_object(
      'action_code', upper(p_action_code),
      'multiplier', p_multiplier,
      'status_before_action', coalesce(p_status_before,'{}'::jsonb),
      'status_after_action', jsonb_build_object(
        'hunger',p_hunger,'happiness',p_happiness,'energy',p_energy
      ),
      'atomic_v2', true
    )
  );

  insert into public.wallets(profile_id,balance)
  values(p_profile_id,0)
  on conflict(profile_id) do nothing;

  if p_coin_earned > 0 then
    select * into v_wallet_result
    from public.credit_wallet(
      p_profile_id,
      p_coin_earned,
      'PET_ACTION',
      'pet_action',
      p_action_id,
      jsonb_build_object('action_code',upper(p_action_code),'atomic_v2',true)
    );
    v_balance := v_wallet_result.balance;
  else
    select w.balance into v_balance
    from public.wallets w
    where w.profile_id = p_profile_id;
  end if;

  if p_levels_gained > 0 then
    select * into v_wallet_result
    from public.credit_wallet(
      p_profile_id,
      p_levels_gained * 50,
      'LEVEL_UP_REWARD',
      'pet_action',
      p_action_id,
      jsonb_build_object('levels_gained',p_levels_gained,'atomic_v2',true)
    );
    v_balance := v_wallet_result.balance;
  end if;

  -- Daily action missions. SLEEP intentionally has no dedicated mission.
  v_mission_type := case upper(p_action_code)
    when 'FEED' then 'FEED'
    when 'PLAY' then 'PLAY'
    when 'WALK' then 'WALK'
    else null
  end;

  if v_mission_type is not null then
    for v_mission in
      select m.id, m.target_value
      from public.missions m
      where m.mission_type = v_mission_type
        and m.is_daily = true
        and m.is_active = true
    loop
      insert into public.mission_progress(
        profile_id,mission_id,mission_date,progress,completed,completed_at
      )
      values(
        p_profile_id,v_mission.id,v_today,1,
        1 >= v_mission.target_value,
        case when 1 >= v_mission.target_value then v_now else null end
      )
      on conflict(profile_id,mission_id,mission_date)
      do update set
        progress = least(
          public.mission_progress.progress + 1,
          v_mission.target_value
        ),
        completed = (
          public.mission_progress.progress + 1 >= v_mission.target_value
        ),
        completed_at = case
          when public.mission_progress.completed then public.mission_progress.completed_at
          when public.mission_progress.progress + 1 >= v_mission.target_value then v_now
          else null
        end;
    end loop;
  end if;

  -- Keep DAILY_ALL synchronized in the same transaction.
  select m.id, m.target_value
    into v_all
  from public.missions m
  where m.mission_type = 'ALL_DAILY'
    and m.is_daily = true
    and m.is_active = true
  limit 1;

  if v_all.id is not null then
    select count(*)::integer
      into v_completed_count
    from public.mission_progress mp
    join public.missions m on m.id = mp.mission_id
    where mp.profile_id = p_profile_id
      and mp.mission_date = v_today
      and mp.completed = true
      and m.is_daily = true
      and m.is_active = true
      and m.mission_type <> 'ALL_DAILY';

    insert into public.mission_progress(
      profile_id,mission_id,mission_date,progress,completed,completed_at
    )
    values(
      p_profile_id,v_all.id,v_today,
      least(v_completed_count,v_all.target_value),
      v_completed_count >= v_all.target_value,
      case when v_completed_count >= v_all.target_value then v_now else null end
    )
    on conflict(profile_id,mission_id,mission_date)
    do update set
      progress = excluded.progress,
      completed = excluded.completed,
      completed_at = case
        when public.mission_progress.completed then public.mission_progress.completed_at
        when excluded.completed then excluded.completed_at
        else null
      end;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_milestones
  from public.grant_pet_action_milestones(
    p_profile_id,p_pet_id,upper(p_action_code)
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
    into v_combos
  from public.grant_pet_action_combo_rewards(
    p_profile_id,p_pet_id
  ) x;

  return jsonb_build_object(
    'actionId',p_action_id,
    'actionCode',upper(p_action_code),
    'actionName',v_action.name,
    'balance',coalesce(v_balance,0),
    'availableAt',v_available_at,
    'milestoneRewards',coalesce(v_milestones,'[]'::jsonb),
    'comboRewards',coalesce(v_combos,'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.perform_pet_action_atomic(uuid,uuid,text,uuid,timestamptz,integer,integer,numeric,numeric,numeric,integer,integer,integer,integer,numeric,integer,jsonb) from public, anon, authenticated;
grant execute on function public.perform_pet_action_atomic(uuid,uuid,text,uuid,timestamptz,integer,integer,numeric,numeric,numeric,integer,integer,integer,integer,numeric,integer,jsonb) to service_role;

