import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

type Role = "owner" | "admin" | "user";

async function requireAdmin(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return {
      error: "인증이 필요합니다.",
      status: 401,
    } as const;
  }

  const admin = getServerAdmin();

  /*
   * Vercel Cron은 사용자 로그인 세션이 없으므로
   * 전용 Secret으로 서버 간 인증한다.
   */
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && token === cronSecret) {
    return {
      admin,
      cron: true,
    } as const;
  }

  const { data: userData, error: userError } =
    await admin.auth.getUser(token);

  const user = userData.user;

  if (userError || !user) {
    return {
      error: "로그인 세션이 유효하지 않습니다.",
      status: 401,
    } as const;
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
    return {
      error: "관리자 권한이 필요합니다.",
      status: 403,
    } as const;
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

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);

    if ("error" in auth) {
      return NextResponse.json(
        {
          ok: false,
          error: auth.error,
        },
        { status: auth.status }
      );
    }

    const secret = process.env.MEETING_INTEGRATION_SECRET;
    const petBaseUrl = process.env.JJINCHIN_PET_URL;

    if (!secret || !petBaseUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "PET 연동 환경변수가 설정되지 않았습니다.",
        },
        { status: 503 }
      );
    }

    /*
     * 오래된 pending부터 제한적으로 처리한다.
     * 한 요청에서 너무 많은 외부 PET 호출이 발생하지 않도록 최대 20건.
     */
    const { data: pendingRows, error: pendingError } = await auth.admin
      .from("pet_attendance_reward_outbox")
      .select(
        "id,meeting_id,member_id,attendance_created_at,status,attempt_count"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (pendingError) {
      console.error("[PET_RETRY] pending lookup failed", pendingError);

      return NextResponse.json(
        {
          ok: false,
          error: "PET 보상 재시도 대기열을 확인하지 못했습니다.",
        },
        { status: 500 }
      );
    }

    if (!pendingRows || pendingRows.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        completed: 0,
        pending: 0,
      });
    }

    const endpoint =
      `${petBaseUrl.replace(/\/+$/, "")}` +
      "/api/integration/meeting/attendance";

    let completed = 0;
    let stillPending = 0;

    for (const row of pendingRows) {
      /*
       * 모임명은 표시용 정보이므로 현재 Meeting DB 값을 사용한다.
       * 보상 가능 시각 판정에는 Outbox의 최초 attendance_created_at을 사용한다.
       */
      const { data: meeting, error: meetingError } = await auth.admin
        .from("meetings")
        .select("title")
        .eq("id", row.meeting_id)
        .maybeSingle();

      if (meetingError) {
        const message = `Meeting lookup failed: ${meetingError.message}`;

        await auth.admin
          .from("pet_attendance_reward_outbox")
          .update({
            last_error: message,
          })
          .eq("id", row.id);

        stillPending += 1;
        continue;
      }

      const meetingName =
        typeof meeting?.title === "string" && meeting.title.trim()
          ? meeting.title.trim()
          : "모임";

      const { error: attemptError } = await auth.admin.rpc(
        "mark_pet_attendance_reward_attempt",
        {
          p_outbox_id: row.id,
        }
      );

      if (attemptError) {
        console.error(
          "[PET_RETRY] attempt update failed",
          row.id,
          attemptError
        );

        stillPending += 1;
        continue;
      }

      try {
        const petResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({
            externalMemberId: row.member_id,
            meetingId: row.meeting_id,
            meetingName,
            attendanceCreatedAt: row.attendance_created_at,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });

        const result = await petResponse.json().catch(() => null);

        if (!petResponse.ok) {
          const message =
            result?.error ??
            `PET server rejected request (${petResponse.status})`;

          await auth.admin
            .from("pet_attendance_reward_outbox")
            .update({
              status: "pending",
              last_error: message,
            })
            .eq("id", row.id);

          stillPending += 1;
          continue;
        }

        /*
         * HTTP 200은 rewarded=true뿐 아니라
         * duplicate / ATTENDANCE_BEFORE_LINK / MEMBER_NOT_LINKED 같은
         * PET 서버의 확정된 처리 결과도 포함한다.
         * 같은 이벤트를 계속 재시도하지 않도록 completed 처리한다.
         */
        const { error: completeError } = await auth.admin
          .from("pet_attendance_reward_outbox")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", row.id);

        if (completeError) {
          console.error(
            "[PET_RETRY] completion update failed",
            row.id,
            completeError
          );

          stillPending += 1;
          continue;
        }

        completed += 1;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "PET server communication failed";

        await auth.admin
          .from("pet_attendance_reward_outbox")
          .update({
            status: "pending",
            last_error: message,
          })
          .eq("id", row.id);

        stillPending += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      processed: pendingRows.length,
      completed,
      pending: stillPending,
    });
  } catch (error) {
    console.error("[PET_RETRY]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "PET 보상 재시도 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

export { POST as GET };
