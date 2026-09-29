import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

type Role = "owner" | "admin" | "user";

type AttendanceRewardRequest = {
  externalMemberId?: unknown;
  meetingId?: unknown;
};

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requireAdmin(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return {
      error: "로그인이 필요합니다.",
      status: 401,
    } as const;
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

    if (!secret) {
      console.error(
        "[PET_ATTENDANCE_PROXY] MEETING_INTEGRATION_SECRET is missing"
      );

      return NextResponse.json(
        {
          ok: false,
          error: "PET integration secret is not configured.",
        },
        { status: 503 }
      );
    }

    if (!petBaseUrl) {
      console.error(
        "[PET_ATTENDANCE_PROXY] JJINCHIN_PET_URL is missing"
      );

      return NextResponse.json(
        {
          ok: false,
          error: "PET server URL is not configured.",
        },
        { status: 503 }
      );
    }

    /*
     * 브라우저에서는 식별자만 받는다.
     * 모임명과 참석 생성시각은 절대 브라우저 값을 신뢰하지 않고
     * Meeting DB에서 서버가 직접 조회한다.
     */
    const body = (await request
      .json()
      .catch(() => null)) as AttendanceRewardRequest | null;

    const externalMemberId = requiredString(body?.externalMemberId);
    const meetingId = requiredString(body?.meetingId);

    if (!externalMemberId || !meetingId) {
      return NextResponse.json(
        {
          ok: false,
          error: "externalMemberId와 meetingId가 필요합니다.",
        },
        { status: 400 }
      );
    }

    /*
     * 실제 attendance 행이 존재하는지 확인한다.
     * 존재하지 않는 참석 정보로 PET 보상을 만들 수 없다.
     */
    const { data: attendance, error: attendanceError } = await auth.admin
      .from("attendance")
      .select("meeting_id,member_id,created_at")
      .eq("meeting_id", meetingId)
      .eq("member_id", externalMemberId)
      .maybeSingle();

    if (attendanceError) {
      console.error(
        "[PET_ATTENDANCE_PROXY] attendance lookup failed",
        attendanceError
      );

      return NextResponse.json(
        {
          ok: false,
          error: "참석 정보를 확인하지 못했습니다.",
        },
        { status: 500 }
      );
    }

    if (!attendance) {
      return NextResponse.json(
        {
          ok: false,
          error: "실제 참석 기록이 존재하지 않습니다.",
        },
        { status: 404 }
      );
    }

    /*
     * 모임명도 Meeting DB에서 직접 가져온다.
     */
    const { data: meeting, error: meetingError } = await auth.admin
      .from("meetings")
      .select("id,title")
      .eq("id", meetingId)
      .maybeSingle();

    if (meetingError) {
      console.error(
        "[PET_ATTENDANCE_PROXY] meeting lookup failed",
        meetingError
      );

      return NextResponse.json(
        {
          ok: false,
          error: "모임 정보를 확인하지 못했습니다.",
        },
        { status: 500 }
      );
    }

    if (!meeting) {
      return NextResponse.json(
        {
          ok: false,
          error: "모임이 존재하지 않습니다.",
        },
        { status: 404 }
      );
    }

    const meetingName =
      typeof meeting.title === "string" && meeting.title.trim()
        ? meeting.title.trim()
        : "모임";

    const attendanceCreatedAt =
      typeof attendance.created_at === "string"
        ? attendance.created_at
        : "";

    if (!attendanceCreatedAt) {
      return NextResponse.json(
        {
          ok: false,
          error: "참석 생성시각을 확인할 수 없습니다.",
        },
        { status: 500 }
      );
    }

    /*
     * PET 호출 전에 Outbox를 먼저 확보한다.
     *
     * (meeting_id, member_id)가 UNIQUE이므로 같은 참석에 대한
     * 중복 요청은 동일한 Outbox 행을 사용한다.
     */
    const { data: existingOutbox, error: existingOutboxError } =
      await auth.admin
        .from("pet_attendance_reward_outbox")
        .select("id,status,attempt_count")
        .eq("meeting_id", attendance.meeting_id)
        .eq("member_id", attendance.member_id)
        .maybeSingle();

    if (existingOutboxError) {
      console.error(
        "[PET_ATTENDANCE_PROXY] outbox lookup failed",
        existingOutboxError
      );

      return NextResponse.json(
        {
          ok: false,
          error: "PET 보상 대기열을 확인하지 못했습니다.",
        },
        { status: 500 }
      );
    }

    /*
     * 이미 완료된 Outbox라면 PET을 다시 호출할 필요가 없다.
     * PET 자체에도 event ID 중복 방지가 있지만 불필요한 호출까지 줄인다.
     */
    if (existingOutbox?.status === "completed") {
      return NextResponse.json({
        ok: true,
        rewarded: false,
        duplicate: true,
        alreadyCompleted: true,
      });
    }

    let outboxId = existingOutbox?.id ?? "";

    if (!outboxId) {
      const { data: createdOutbox, error: createOutboxError } =
        await auth.admin
          .from("pet_attendance_reward_outbox")
          .insert({
            meeting_id: attendance.meeting_id,
            member_id: attendance.member_id,
            attendance_created_at: attendanceCreatedAt,
            status: "pending",
          })
          .select("id")
          .single();

      if (createOutboxError || !createdOutbox) {
        /*
         * 동시에 같은 이벤트가 들어온 경우 UNIQUE 충돌일 수 있으므로
         * 한 번 다시 조회한다.
         */
        const { data: racedOutbox, error: racedOutboxError } =
          await auth.admin
            .from("pet_attendance_reward_outbox")
            .select("id,status,attempt_count")
            .eq("meeting_id", attendance.meeting_id)
            .eq("member_id", attendance.member_id)
            .maybeSingle();

        if (racedOutboxError || !racedOutbox) {
          console.error(
            "[PET_ATTENDANCE_PROXY] outbox create failed",
            createOutboxError,
            racedOutboxError
          );

          return NextResponse.json(
            {
              ok: false,
              error: "PET 보상 대기열을 생성하지 못했습니다.",
            },
            { status: 500 }
          );
        }

        if (racedOutbox.status === "completed") {
          return NextResponse.json({
            ok: true,
            rewarded: false,
            duplicate: true,
            alreadyCompleted: true,
          });
        }

        outboxId = racedOutbox.id;
      } else {
        outboxId = createdOutbox.id;
      }
    }

    /*
     * 이번 PET 전송 시도를 DB에서 원자적으로 기록한다.
     * 동시에 같은 이벤트가 재시도되더라도 attempt_count 증가가 유실되지 않는다.
     */
    const { error: attemptUpdateError } = await auth.admin.rpc(
      "mark_pet_attendance_reward_attempt",
      {
        p_outbox_id: outboxId,
      }
    );

    if (attemptUpdateError) {
      console.error(
        "[PET_ATTENDANCE_PROXY] outbox attempt update failed",
        attemptUpdateError
      );

      return NextResponse.json(
        {
          ok: false,
          error: "PET 보상 시도 상태를 기록하지 못했습니다.",
        },
        { status: 500 }
      );
    }

    /*
     * PET 서버에는 Meeting DB에서 검증된 데이터만 전달한다.
     */
    const endpoint =
      `${petBaseUrl.replace(/\/+$/, "")}` +
      "/api/integration/meeting/attendance";

    try {
      const petResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          externalMemberId: attendance.member_id,
          meetingId: attendance.meeting_id,
          meetingName,
          attendanceCreatedAt,
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
          .eq("id", outboxId);

        console.error(
          "[PET_ATTENDANCE_PROXY] PET server rejected request",
          petResponse.status,
          result
        );

        return NextResponse.json(
          {
            ok: false,
            petStatus: petResponse.status,
            error:
              result?.error ??
              "PET 서버에서 참석 보상 처리를 거부했습니다.",
            retryPending: true,
          },
          { status: 502 }
        );
      }

      /*
       * PET에서 정상 응답을 받았으면 완료 처리한다.
       *
       * PET 응답이 duplicate여도 해당 이벤트가 이미 처리됐다는
       * 의미이므로 Outbox는 completed가 맞다.
       */
      const { error: completeError } = await auth.admin
        .from("pet_attendance_reward_outbox")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", outboxId);

      if (completeError) {
        /*
         * PET 지급은 이미 성공했을 수 있다.
         * completed 기록 실패 시 pending으로 남더라도 다음 재시도는
         * PET의 event ID 중복 방지로 이중 지급되지 않는다.
         */
        console.error(
          "[PET_ATTENDANCE_PROXY] outbox completion update failed",
          completeError
        );
      }

      return NextResponse.json(result);
    } catch (petError) {
      const message =
        petError instanceof Error
          ? petError.message
          : "PET server communication failed";

      await auth.admin
        .from("pet_attendance_reward_outbox")
        .update({
          status: "pending",
          last_error: message,
        })
        .eq("id", outboxId);

      console.error(
        "[PET_ATTENDANCE_PROXY] PET communication failed",
        petError
      );

      return NextResponse.json(
        {
          ok: false,
          error: "PET 참석 보상 서버와 통신하지 못했습니다.",
          retryPending: true,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("[PET_ATTENDANCE_PROXY]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "PET 참석 보상 서버와 통신하지 못했습니다.",
      },
      { status: 502 }
    );
  }
}
