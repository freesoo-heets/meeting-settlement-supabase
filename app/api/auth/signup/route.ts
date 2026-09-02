import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

function normalizeNickname(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const { nickname, password } = await request.json();
    const cleanNickname = normalizeNickname(nickname);
    const cleanPassword = String(password ?? "");

    if (cleanNickname.length < 2 || cleanNickname.length > 20) {
      return NextResponse.json(
        { error: "닉네임은 2~20자로 입력해주세요." },
        { status: 400 }
      );
    }

    if (cleanPassword.length < 6) {
      return NextResponse.json(
        { error: "비밀번호는 6자 이상으로 입력해주세요." },
        { status: 400 }
      );
    }

    const nicknameKey = cleanNickname.toLowerCase();
    const admin = getServerAdmin();

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("nickname_key", nicknameKey)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: "이미 가입된 닉네임입니다. 로그인해주세요." },
        { status: 409 }
      );
    }

    // 기존 회원 명단에 같은 닉네임이 있고 로그인 계정만 없다면 그 회원에 연결합니다.
    const { data: matchedMembers, error: memberFindError } = await admin
      .from("members")
      .select("id,name,active")
      .ilike("name", cleanNickname)
      .limit(1);

    if (memberFindError) {
      return NextResponse.json(
        { error: memberFindError.message },
        { status: 400 }
      );
    }

    let member = matchedMembers?.[0] ?? null;
    let createdMemberId: string | null = null;

    if (member && !member.active) {
      return NextResponse.json(
        { error: "탈퇴 처리된 닉네임입니다. 관리자에게 문의해주세요." },
        { status: 403 }
      );
    }

    if (!member) {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const { data: createdMember, error: createMemberError } = await admin
        .from("members")
        .insert({
          name: cleanNickname,
          active: true,
          join_date: today,
          withdrawn_at: null,
        })
        .select("id,name,active")
        .single();

      if (createMemberError || !createdMember) {
        return NextResponse.json(
          { error: createMemberError?.message ?? "회원 등록에 실패했습니다." },
          { status: 400 }
        );
      }

      member = createdMember;
      createdMemberId = createdMember.id;
    }

    const { data: memberProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("member_id", member.id)
      .maybeSingle();

    if (memberProfile) {
      return NextResponse.json(
        { error: "이미 로그인 계정이 연결된 회원입니다." },
        { status: 409 }
      );
    }

    const authEmail = `member-${member.id.replaceAll("-", "")}@jjinc.app`;
    const { data: createdUser, error: authError } =
      await admin.auth.admin.createUser({
        email: authEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: { nickname: cleanNickname },
      });

    if (authError || !createdUser.user) {
      if (createdMemberId) {
        await admin.from("members").delete().eq("id", createdMemberId);
      }

      return NextResponse.json(
        { error: authError?.message ?? "로그인 계정 생성에 실패했습니다." },
        { status: 400 }
      );
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: createdUser.user.id,
      member_id: member.id,
      nickname: cleanNickname,
      nickname_key: nicknameKey,
      auth_email: authEmail,
      role: "user",
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(createdUser.user.id);
      if (createdMemberId) {
        await admin.from("members").delete().eq("id", createdMemberId);
      }

      return NextResponse.json(
        { error: profileError.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      email: authEmail,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "가입 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
