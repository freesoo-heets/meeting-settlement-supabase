import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

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

function getPetConfig() {
  const secret = process.env.MEETING_INTEGRATION_SECRET;
  const petBaseUrl = process.env.JJINCHIN_PET_URL;

  if (!secret || !petBaseUrl) return null;

  return {
    secret,
    baseUrl: petBaseUrl.replace(/\/+$/, ""),
  };
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

    const config = getPetConfig();

    if (!config) {
      return NextResponse.json(
        {
          ok: false,
          error: "PET 연동 서버 설정이 완료되지 않았습니다.",
        },
        { status: 503 }
      );
    }

    const endpoint =
      `${config.baseUrl}/api/integration/meeting/me` +
      `?externalMemberId=${encodeURIComponent(auth.profile.member_id)}`;

    const petResponse = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.secret}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    const result = await petResponse.json().catch(() => null);

    if (!petResponse.ok) {
      console.error(
        "[PET_ME_PROXY] PET server rejected request",
        petResponse.status,
        result
      );

      return NextResponse.json(
        {
          ok: false,
          petStatus: petResponse.status,
          error: result?.error ?? "PET 상태를 확인하지 못했습니다.",
        },
        { status: petResponse.status === 401 ? 502 : petResponse.status }
      );
    }

    return NextResponse.json({
      ...result,
      meetingNickname: auth.profile.nickname,
    });
  } catch (error) {
    console.error("[PET_ME_PROXY]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "PET 연동 서버와 통신하지 못했습니다.",
      },
      { status: 502 }
    );
  }
}
