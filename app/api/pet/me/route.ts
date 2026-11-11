import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";
import {
  getPetBackendMode,
  type MeetingPetIdentity,
  type PetBackend,
} from "../../../../lib/pet/backend";
import { BridgePetBackend } from "../../../../lib/pet/bridge-backend";
import { LocalPetBackend } from "../../../../lib/pet/local-backend";

type MeetingProfile = {
  id: string;
  member_id: string;
  nickname: string;
  role: "owner" | "admin" | "user";
};

async function requireUser(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return { error: "로그인이 필요합니다.", status: 401 } as const;
  }

  const admin = getServerAdmin();
  const { data: userData, error: userError } =
    await admin.auth.getUser(token);

  const user = userData.user;

  if (userError || !user) {
    return {
      error: "로그인 세션이 유효하지 않습니다.",
      status: 401,
    } as const;
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,member_id,nickname,role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      error: "로그인 회원 정보를 찾을 수 없습니다.",
      status: 404,
    } as const;
  }

  if (!profile.member_id) {
    return {
      error: "회원 연결 정보가 올바르지 않습니다.",
      status: 409,
    } as const;
  }

  return { profile: profile as MeetingProfile } as const;
}

function createPetBackend(): PetBackend {
  return getPetBackendMode() === "local"
    ? new LocalPetBackend()
    : new BridgePetBackend();
}

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const identity: MeetingPetIdentity = {
      profileId: auth.profile.id,
      memberId: auth.profile.member_id,
      nickname: auth.profile.nickname,
    };

    const backend = createPetBackend();
    const result = await backend.getSummary(identity);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PET 상태 조회 실패";

    if (message === "PET_LOCAL_BACKEND_NOT_READY") {
      console.error("[PET_ME_PROXY] local backend requested before readiness");

      return NextResponse.json(
        {
          ok: false,
          error: "통합 PET 데이터 이관이 아직 완료되지 않았습니다.",
        },
        { status: 503 }
      );
    }

    if (message === "PET_BRIDGE_CONFIG_MISSING") {
      console.error("[PET_ME_PROXY] PET bridge config is missing");

      return NextResponse.json(
        {
          ok: false,
          error: "PET 연동 서버 설정이 완료되지 않았습니다.",
        },
        { status: 503 }
      );
    }

    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? Number((error as { status: number }).status)
        : 502;

    console.error("[PET_ME_PROXY]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "PET 연동 서버와 통신하지 못했습니다.",
      },
      { status: status === 401 ? 502 : status }
    );
  }
}
