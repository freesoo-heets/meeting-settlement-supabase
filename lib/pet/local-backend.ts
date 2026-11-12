import { getServerAdmin } from "../server-admin";
import type {
  MeetingPetIdentity,
  PetBackend,
} from "./backend";
import type { PetIntegrationSummary } from "../pet-integration-types";
import { calculateCurrentStatus } from "./status-engine";

export class LocalPetBackend implements PetBackend {
  async getSummary(
    identity: MeetingPetIdentity
  ): Promise<PetIntegrationSummary> {
    const admin = getServerAdmin();

    const { data: migration, error: migrationError } = await admin
      .from("pet_migration_profile_map")
      .select("migration_status")
      .eq("new_meeting_profile_id", identity.profileId)
      .maybeSingle();

    if (migrationError) throw migrationError;

    if (!migration || migration.migration_status !== "migrated") {
      throw new Error("PET_LOCAL_PROFILE_NOT_MIGRATED");
    }

    const { data: pet, error: petError } = await admin
      .from("pets")
      .select(
        "id,owner_id,species_id,name,level,exp,hunger,happiness,energy,affection,last_status_calculated_at,born_at"
      )
      .eq("owner_id", identity.profileId)
      .maybeSingle();

    if (petError) throw petError;

    const { data: wallet, error: walletError } = await admin
      .from("wallets")
      .select("balance")
      .eq("profile_id", identity.profileId)
      .maybeSingle();

    if (walletError) throw walletError;

    if (!pet) {
      return {
        ok: true,
        linked: true,
        backendSource: "local",
        externalMemberId: identity.memberId,
        externalNickname: identity.nickname,
        meetingNickname: identity.nickname,
        profile: {
          id: identity.profileId,
          nickname: identity.nickname,
        },
        hasPet: false,
        balance: Number(wallet?.balance ?? 0),
        pet: null,
        actions: [],
        serverTime: new Date().toISOString(),
      };
    }

    const now = new Date();
    const current = calculateCurrentStatus(
      {
        hunger: Number(pet.hunger),
        happiness: Number(pet.happiness),
        energy: Number(pet.energy),
        last_status_calculated_at: pet.last_status_calculated_at,
      },
      now
    );

    const [persistResult, speciesResult, shareResult, actionTypesResult] =
      await Promise.all([
        admin
          .from("pets")
          .update({
            hunger: current.hunger,
            happiness: current.happiness,
            energy: current.energy,
            last_status_calculated_at: current.calculatedAt,
          })
          .eq("id", pet.id)
          .eq("owner_id", identity.profileId),
        admin
          .from("pet_species")
          .select("code,name")
          .eq("id", pet.species_id)
          .maybeSingle(),
        admin
          .from("pet_share_profiles")
          .select("public_code")
          .eq("pet_id", pet.id)
          .maybeSingle(),
        admin
          .from("pet_action_types")
          .select("id,code,name,cooldown_seconds")
          .eq("is_active", true)
          .in("code", ["FEED", "PLAY", "WALK", "SLEEP"]),
      ]);

    if (persistResult.error) throw persistResult.error;
    if (speciesResult.error) throw speciesResult.error;
    if (shareResult.error) throw shareResult.error;
    if (actionTypesResult.error) throw actionTypesResult.error;

    const actionTypes = actionTypesResult.data ?? [];
    const ids = actionTypes.map((row) => row.id);

    const { data: cooldownRows, error: cooldownError } =
      ids.length > 0
        ? await admin
            .from("pet_action_cooldowns")
            .select("action_type_id,available_at")
            .eq("pet_id", pet.id)
            .in("action_type_id", ids)
        : { data: [], error: null };

    if (cooldownError) throw cooldownError;

    const cooldownByType = new Map(
      (cooldownRows ?? []).map((row) => [
        row.action_type_id,
        row.available_at,
      ])
    );

    const nowMs = now.getTime();
    const actions = actionTypes.map((action) => {
      const availableAt = cooldownByType.get(action.id) || null;
      const availableAtMs = availableAt
        ? new Date(availableAt).getTime()
        : 0;

      return {
        code: action.code,
        name: action.name,
        cooldownSeconds: Number(action.cooldown_seconds || 0),
        available: !availableAt || availableAtMs <= nowMs,
        availableAt,
        remainingSeconds:
          availableAtMs > nowMs
            ? Math.max(1, Math.ceil((availableAtMs - nowMs) / 1000))
            : 0,
      };
    });

    return {
      ok: true,
      linked: true,
      backendSource: "local",
      externalMemberId: identity.memberId,
      externalNickname: identity.nickname,
      meetingNickname: identity.nickname,
      profile: {
        id: identity.profileId,
        nickname: identity.nickname,
      },
      hasPet: true,
      balance: Number(wallet?.balance ?? 0),
      pet: {
        id: pet.id,
        name: pet.name,
        level: Number(pet.level),
        exp: Number(pet.exp),
        hunger: current.hunger,
        happiness: current.happiness,
        energy: current.energy,
        affection: Number(pet.affection),
        bornAt: pet.born_at,
        species: speciesResult.data
          ? {
              code: speciesResult.data.code,
              name: speciesResult.data.name,
            }
          : null,
        publicCode: shareResult.data?.public_code ?? null,
      },
      actions,
      serverTime: now.toISOString(),
    };
  }
}
