import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";
import {
  calculateCurrentStatus,
  clamp,
  growthMultiplier,
  round2,
} from "../../../../lib/pet/status-engine";
import { applyExperience } from "../../../../lib/pet/level-engine";

const ALLOWED_ACTIONS = new Set(["FEED", "PLAY", "WALK", "SLEEP"]);

type MeetingProfile = {
  id: string;
  member_id: string;
  nickname: string;
};

function dbMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { message?: string; details?: string };
  return `${value.message || ""} ${value.details || ""}`.trim();
}

async function requireMigratedUser(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return { error: "로그인이 필요합니다.", status: 401 } as const;
  }

  const admin = getServerAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    return {
      error: "로그인 세션이 유효하지 않습니다.",
      status: 401,
    } as const;
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,member_id,nickname")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      error: "로그인 회원 정보를 찾을 수 없습니다.",
      status: 404,
    } as const;
  }

  const { data: migration, error: migrationError } = await admin
    .from("pet_migration_profile_map")
    .select("migration_status")
    .eq("new_meeting_profile_id", profile.id)
    .maybeSingle();

  if (migrationError) throw migrationError;

  if (!migration || migration.migration_status !== "migrated") {
    return {
      error: "이 계정은 아직 PET 쓰기 데이터 이관이 완료되지 않았습니다.",
      status: 409,
    } as const;
  }

  return {
    admin,
    profile: profile as MeetingProfile,
  } as const;
}

export async function POST(request: Request) {
  const auth = await requireMigratedUser(request);
  if ("error" in auth) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const actionCode = String(body?.actionCode || "").toUpperCase();

    if (!ALLOWED_ACTIONS.has(actionCode)) {
      return NextResponse.json(
        { ok: false, error: "지원하지 않는 행동입니다." },
        { status: 400 }
      );
    }

    const now = new Date();
    const [petResult, actionTypeResult] = await Promise.all([
      auth.admin
        .from("pets")
        .select(
          "id,owner_id,level,exp,hunger,happiness,energy,affection,last_status_calculated_at"
        )
        .eq("owner_id", auth.profile.id)
        .maybeSingle(),
      auth.admin
        .from("pet_action_types")
        .select(
          "id,code,name,cooldown_seconds,hunger_change,happiness_change,energy_change,exp_reward,affection_reward,coin_reward"
        )
        .eq("code", actionCode)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    const pet = petResult.data;
    const actionType = actionTypeResult.data;

    if (petResult.error || !pet) {
      return NextResponse.json(
        { ok: false, error: "PET을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (actionTypeResult.error || !actionType) {
      throw actionTypeResult.error || new Error("행동 정보를 찾을 수 없습니다.");
    }

    const current = calculateCurrentStatus(
      {
        hunger: Number(pet.hunger),
        happiness: Number(pet.happiness),
        energy: Number(pet.energy),
        last_status_calculated_at: pet.last_status_calculated_at,
      },
      now
    );

    const energyCost = Math.min(0, Number(actionType.energy_change));
    if (energyCost < 0 && current.energy + energyCost < 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_ENOUGH_ENERGY",
          error: "에너지가 부족해요. 먼저 PET을 쉬게 해주세요.",
          currentEnergy: current.energy,
        },
        { status: 400 }
      );
    }

    const nextHunger = round2(
      clamp(current.hunger + Number(actionType.hunger_change))
    );
    const nextHappiness = round2(
      clamp(current.happiness + Number(actionType.happiness_change))
    );
    const nextEnergy = round2(
      clamp(current.energy + Number(actionType.energy_change))
    );

    const multiplier = growthMultiplier(nextHunger, nextHappiness);
    const earnedExp = Math.max(
      0,
      Math.round(Number(actionType.exp_reward) * multiplier)
    );
    const earnedAffection = Math.max(
      0,
      Number(actionType.affection_reward)
    );
    const earnedCoin = Math.max(0, Number(actionType.coin_reward));

    const levelResult = applyExperience(
      Number(pet.level),
      Number(pet.exp),
      earnedExp
    );

    const actionId = randomUUID();
    const { data: atomicResult, error: atomicError } = await auth.admin.rpc(
      "perform_pet_action_atomic",
      {
        p_profile_id: auth.profile.id,
        p_pet_id: pet.id,
        p_action_code: actionCode,
        p_action_id: actionId,
        p_expected_last_status_calculated_at: pet.last_status_calculated_at,
        p_level: levelResult.level,
        p_exp: levelResult.exp,
        p_hunger: nextHunger,
        p_happiness: nextHappiness,
        p_energy: nextEnergy,
        p_affection: Number(pet.affection) + earnedAffection,
        p_exp_earned: earnedExp,
        p_affection_earned: earnedAffection,
        p_coin_earned: earnedCoin,
        p_multiplier: multiplier,
        p_levels_gained: levelResult.levelsGained,
        p_status_before: current,
      }
    );

    if (atomicError) {
      const message = dbMessage(atomicError);

      if (message.includes("COOLDOWN|")) {
        const raw = message.split("COOLDOWN|")[1]?.trim().split(/\s/)[0];
        const availableAt = raw ? new Date(raw) : null;
        const validDate =
          availableAt && !Number.isNaN(availableAt.getTime())
            ? availableAt
            : null;

        return NextResponse.json(
          {
            ok: false,
            code: "COOLDOWN",
            error: "아직 다시 할 수 없어요.",
            availableAt: validDate?.toISOString(),
            remainingSeconds: validDate
              ? Math.max(
                  1,
                  Math.ceil((validDate.getTime() - Date.now()) / 1000)
                )
              : undefined,
          },
          { status: 429 }
        );
      }

      if (message.includes("PET_STATE_CHANGED")) {
        return NextResponse.json(
          {
            ok: false,
            code: "PET_STATE_CHANGED",
            error: "PET 상태가 방금 변경됐어요. 다시 한 번 눌러주세요.",
          },
          { status: 409 }
        );
      }

      throw atomicError;
    }

    const result =
      atomicResult && typeof atomicResult === "object"
        ? (atomicResult as Record<string, unknown>)
        : {};

    return NextResponse.json({
      ok: true,
      result: {
        actionId,
        actionCode,
        actionName: actionType.name,
        expEarned: earnedExp,
        affectionEarned: earnedAffection,
        coinEarned: earnedCoin,
        levelUpCoin: levelResult.levelsGained * 50,
        balance: Number(result.balance ?? 0),
        multiplier,
        levelsGained: levelResult.levelsGained,
        level: levelResult.level,
        exp: levelResult.exp,
        hunger: nextHunger,
        happiness: nextHappiness,
        energy: nextEnergy,
        affection: Number(pet.affection) + earnedAffection,
        availableAt: result.availableAt,
        milestoneRewards: Array.isArray(result.milestoneRewards)
          ? result.milestoneRewards
          : [],
        comboRewards: Array.isArray(result.comboRewards)
          ? result.comboRewards
          : [],
      },
    });
  } catch (error) {
    console.error("[PET_LOCAL_ACTION]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "PET 행동 처리에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
