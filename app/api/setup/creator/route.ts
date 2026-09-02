import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

export async function POST(request: Request) {
  try {
    const { setupKey, nickname } = await request.json();

    if (
      !process.env.CREATOR_SETUP_KEY ||
      String(setupKey ?? "") !== process.env.CREATOR_SETUP_KEY
    ) {
      return NextResponse.json(
        { error: "제작자 설정키가 올바르지 않습니다." },
        { status: 403 }
      );
    }

    const cleanNickname = String(nickname ?? "").trim();
    if (!cleanNickname) {
      return NextResponse.json(
        { error: "이미 가입한 제작자 닉네임을 입력해주세요." },
        { status: 400 }
      );
    }

    const admin = getServerAdmin();

    const { data: existingOwner } = await admin
      .from("profiles")
      .select("id,nickname")
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    if (existingOwner) {
      return NextResponse.json(
        { error: `제작자는 이미 ${existingOwner.nickname} 님으로 지정되어 있습니다.` },
        { status: 409 }
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,nickname")
      .eq("nickname_key", cleanNickname.toLowerCase())
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "먼저 '최초 가입'에서 해당 닉네임으로 가입해주세요." },
        { status: 404 }
      );
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", profile.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "제작자 설정 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
