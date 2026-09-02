import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

export async function POST(request: Request) {
  try {
    const { nickname } = await request.json();
    const nicknameKey = String(nickname ?? "").trim().toLowerCase();

    if (!nicknameKey) {
      return NextResponse.json(
        { error: "닉네임을 입력해주세요." },
        { status: 400 }
      );
    }

    const admin = getServerAdmin();
    const { data: profile, error } = await admin
      .from("profiles")
      .select("auth_email, member_id")
      .eq("nickname_key", nicknameKey)
      .maybeSingle();

    if (error || !profile) {
      return NextResponse.json(
        { error: "등록된 로그인 계정을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: member } = await admin
      .from("members")
      .select("active")
      .eq("id", profile.member_id)
      .maybeSingle();

    if (!member?.active) {
      return NextResponse.json(
        { error: "탈퇴 처리된 회원은 로그인할 수 없습니다." },
        { status: 403 }
      );
    }

    return NextResponse.json({ email: profile.auth_email });
  } catch {
    return NextResponse.json(
      { error: "로그인 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
