import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

type Role = "owner" | "admin" | "user";

async function requireAdmin(request: Request) {
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
    return { error: "로그인 세션이 유효하지 않습니다.", status: 401 } as const;
  }

  const { data: requester, error: requesterError } = await admin
    .from("profiles")
    .select("id,member_id,nickname,role")
    .eq("id", user.id)
    .maybeSingle();

  if (
    requesterError ||
    !requester ||
    !["owner", "admin"].includes(String(requester.role))
  ) {
    return { error: "관리자 권한이 필요합니다.", status: 403 } as const;
  }

  return {
    admin,
    user,
    requester: requester as {
      id: string;
      member_id: string;
      nickname: string;
      role: Role;
    },
  } as const;
}

function cleanNickname(value: unknown) {
  return String(value ?? "").trim();
}


export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { action, memberId, password } = await request.json();

    if (action !== "reset-password") {
      return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    }

    const cleanMemberId = String(memberId ?? "").trim();
    const cleanPassword = String(password ?? "");

    if (!cleanMemberId) {
      return NextResponse.json({ error: "회원 정보가 없습니다." }, { status: 400 });
    }

    if (cleanPassword.length < 6 || cleanPassword.length > 72) {
      return NextResponse.json(
        { error: "새 비밀번호는 6~72자로 입력해주세요." },
        { status: 400 }
      );
    }

    const { admin, requester } = auth;

    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id,name")
      .eq("id", cleanMemberId)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "회원 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: targetProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,member_id,nickname,role")
      .eq("member_id", cleanMemberId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    if (!targetProfile) {
      return NextResponse.json(
        { error: "아직 최초 가입을 하지 않아 로그인 계정이 없습니다." },
        { status: 409 }
      );
    }

    if (requester.member_id === cleanMemberId) {
      return NextResponse.json(
        { error: "본인 비밀번호는 내 계정에서 변경해주세요." },
        { status: 403 }
      );
    }

    if (targetProfile.role === "owner") {
      return NextResponse.json(
        { error: "제작자 계정의 비밀번호는 관리자 화면에서 재설정할 수 없습니다." },
        { status: 403 }
      );
    }

    if (requester.role === "admin" && targetProfile.role === "admin") {
      return NextResponse.json(
        { error: "관리자는 다른 관리자의 비밀번호를 재설정할 수 없습니다." },
        { status: 403 }
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(
      targetProfile.id,
      { password: cleanPassword }
    );

    if (updateError) {
      return NextResponse.json(
        { error: `비밀번호 재설정 실패: ${updateError.message}` },
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
            : "비밀번호 재설정 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { memberId, nickname } = await request.json();
    const cleanMemberId = String(memberId ?? "").trim();
    const cleanName = cleanNickname(nickname);

    if (!cleanMemberId) {
      return NextResponse.json({ error: "회원 정보가 없습니다." }, { status: 400 });
    }

    if (cleanName.length < 2 || cleanName.length > 20) {
      return NextResponse.json(
        { error: "닉네임은 2~20자로 입력해주세요." },
        { status: 400 }
      );
    }

    const { admin, requester } = auth;

    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id,name")
      .eq("id", cleanMemberId)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "회원 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: targetProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,member_id,nickname,nickname_key,role")
      .eq("member_id", cleanMemberId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    if (targetProfile?.role === "owner" && requester.role !== "owner") {
      return NextResponse.json(
        { error: "관리자는 제작자의 닉네임을 수정할 수 없습니다." },
        { status: 403 }
      );
    }

    if (
      targetProfile?.role === "admin" &&
      requester.role === "admin" &&
      requester.member_id !== cleanMemberId
    ) {
      return NextResponse.json(
        { error: "관리자는 다른 관리자의 닉네임을 수정할 수 없습니다." },
        { status: 403 }
      );
    }

    const nicknameKey = cleanName.toLowerCase();

    const { data: duplicateMembers } = await admin
      .from("members")
      .select("id")
      .ilike("name", cleanName)
      .neq("id", cleanMemberId)
      .limit(1);

    if ((duplicateMembers ?? []).length > 0) {
      return NextResponse.json(
        { error: "이미 등록된 닉네임입니다." },
        { status: 409 }
      );
    }

    const { data: duplicateProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("nickname_key", nicknameKey)
      .neq("member_id", cleanMemberId)
      .limit(1);

    if ((duplicateProfile ?? []).length > 0) {
      return NextResponse.json(
        { error: "이미 로그인 계정에서 사용 중인 닉네임입니다." },
        { status: 409 }
      );
    }

    const oldName = member.name;

    const { error: memberUpdateError } = await admin
      .from("members")
      .update({ name: cleanName })
      .eq("id", cleanMemberId);

    if (memberUpdateError) {
      return NextResponse.json(
        { error: memberUpdateError.message },
        { status: 400 }
      );
    }

    if (targetProfile) {
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({
          nickname: cleanName,
          nickname_key: nicknameKey,
        })
        .eq("id", targetProfile.id);

      if (profileUpdateError) {
        await admin.from("members").update({ name: oldName }).eq("id", cleanMemberId);
        return NextResponse.json(
          { error: `로그인 닉네임 변경 실패: ${profileUpdateError.message}` },
          { status: 400 }
        );
      }

      // 로그인에는 profiles.nickname_key가 사용되므로 metadata 변경 실패는 치명적이지 않습니다.
      await admin.auth.admin.updateUserById(targetProfile.id, {
        user_metadata: { nickname: cleanName },
      });
    }

    return NextResponse.json({ ok: true, nickname: cleanName });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "닉네임 수정 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { memberId } = await request.json();
    const cleanMemberId = String(memberId ?? "").trim();

    if (!cleanMemberId) {
      return NextResponse.json({ error: "회원 정보가 없습니다." }, { status: 400 });
    }

    const { admin, requester } = auth;

    if (requester.member_id === cleanMemberId) {
      return NextResponse.json(
        { error: "현재 로그인한 본인 계정은 삭제할 수 없습니다." },
        { status: 403 }
      );
    }

    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id,name")
      .eq("id", cleanMemberId)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "회원 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: targetProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,role")
      .eq("member_id", cleanMemberId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    if (targetProfile?.role === "owner") {
      return NextResponse.json(
        { error: "제작자(owner) 계정은 삭제할 수 없습니다." },
        { status: 403 }
      );
    }

    if (targetProfile?.role === "admin" && requester.role !== "owner") {
      return NextResponse.json(
        { error: "관리자는 다른 관리자 계정을 삭제할 수 없습니다." },
        { status: 403 }
      );
    }

    // Auth를 먼저 제거하면 profiles가 cascade 삭제됩니다.
    // 이후 members 삭제가 실패해도 해당 회원은 다시 최초 가입할 수 있는 상태로 남습니다.
    if (targetProfile?.id) {
      const { error: authDeleteError } =
        await admin.auth.admin.deleteUser(targetProfile.id);

      if (authDeleteError) {
        return NextResponse.json(
          { error: `로그인 계정 삭제 실패: ${authDeleteError.message}` },
          { status: 400 }
        );
      }
    }

    const { error: deleteError } = await admin
      .from("members")
      .delete()
      .eq("id", cleanMemberId);

    if (deleteError) {
      return NextResponse.json(
        {
          error:
            `로그인 계정은 삭제됐지만 회원 데이터 삭제에 실패했습니다: ${deleteError.message}`,
        },
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
            : "회원 삭제 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
