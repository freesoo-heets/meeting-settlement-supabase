import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const admin = getServerAdmin();
    const { data: userResult, error: userError } =
      await admin.auth.getUser(token);

    if (userError || !userResult.user) {
      return NextResponse.json(
        { error: "로그인 정보를 확인할 수 없습니다." },
        { status: 401 }
      );
    }

    const { data: requester } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userResult.user.id)
      .maybeSingle();

    if (!requester || !["owner", "admin"].includes(requester.role)) {
      return NextResponse.json(
        { error: "관리자 권한이 필요합니다." },
        { status: 403 }
      );
    }

    const { memberId, password } = await request.json();
    const cleanPassword = String(password ?? "");

    if (!memberId || cleanPassword.length < 6) {
      return NextResponse.json(
        { error: "회원과 6자 이상 비밀번호를 확인해주세요." },
        { status: 400 }
      );
    }

    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id,name")
      .eq("id", memberId)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "회원을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id,role")
      .eq("member_id", member.id)
      .maybeSingle();

    if (existingProfile) {
      if (
        existingProfile.role === "owner" &&
        requester.role !== "owner"
      ) {
        return NextResponse.json(
          { error: "제작자 계정은 제작자만 변경할 수 있습니다." },
          { status: 403 }
        );
      }

      const { error: updateError } =
        await admin.auth.admin.updateUserById(existingProfile.id, {
          password: cleanPassword,
        });

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 400 }
        );
      }

      return NextResponse.json({ ok: true, mode: "reset" });
    }

    const authEmail = `member-${member.id.replaceAll("-", "")}@jjinc.app`;
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: authEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: { nickname: member.name },
      });

    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? "계정 생성에 실패했습니다." },
        { status: 400 }
      );
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      member_id: member.id,
      nickname: member.name,
      nickname_key: member.name.trim().toLowerCase(),
      auth_email: authEmail,
      role: "user",
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json(
        { error: profileError.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, mode: "created" });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "회원 계정 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
