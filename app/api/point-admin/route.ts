import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId } from "../../../lib/gameServer";
import { POINT_ADMIN_MAX, TICKET_ADMIN_MAX, REASON_MAX } from "../../../lib/pointAdmin";

/*
 * ⚙️ 관리자 점수 · 티켓 조정 (카톡 !점수추가 · !점수감소 · !티켓추가 · !티켓감소 와 같음)
 *  · adjust → point_adjustments(requested) → 봇이 점수판에 반영한 뒤 done (대상을 못 찾으면 failed)
 *  · status → 요청 상태 · 반영 뒤 점수 · 티켓
 */

export async function POST(request: Request) {
  const admin = getServerAdmin();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  if (!(await isAdminMember(admin, auth.memberId))) return fail("관리자만 쓸 수 있어요.", 403);

  if (action === "adjust") {
    const uid = typeof body.uid === "string" ? body.uid : "";
    const points = Number(body.points ?? 0);
    const tickets = Number(body.tickets ?? 0);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isInteger(points) || Math.abs(points) > POINT_ADMIN_MAX) {
      return fail(`점수는 한 번에 ${POINT_ADMIN_MAX.toLocaleString("ko-KR")}점까지 바꿀 수 있습니다.`);
    }
    if (!Number.isInteger(tickets) || Math.abs(tickets) > TICKET_ADMIN_MAX) {
      return fail(`티켓은 한 번에 ${TICKET_ADMIN_MAX}장까지 바꿀 수 있습니다.`);
    }
    if (!points && !tickets) return fail("바꿀 점수나 티켓을 입력해 주세요.");
    if (points && !reason) return fail("점수를 바꿀 때는 사유가 필요합니다.");
    if (reason.length > REASON_MAX) return fail(`사유는 ${REASON_MAX}자까지 쓸 수 있습니다.`);

    const manager = await loadMember(admin, auth.memberId);
    if ("error" in manager) return fail(manager.error, manager.status);
    const { data: target } = await admin.from("bot_points").select("kakao_uid,name").eq("kakao_uid", uid).maybeSingle();
    if (!target) return fail("점수판에서 찾지 못했습니다.", 404);

    // 봇이 꺼져 있으면 요청이 쌓이므로, 앞 요청이 끝나기 전에는 같은 사람에게 또 넣지 않는다 (두 번 반영 방지)
    const { data: waiting, error: waitError } = await admin
      .from("point_adjustments")
      .select("id")
      .eq("uid", uid)
      .in("state", ["requested", "processing"])
      .limit(1);
    if (waitError) {
      const missing = /point_adjustments/.test(waitError.message) && /exist|schema cache/i.test(waitError.message);
      return fail(missing ? "점수 관리 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)" : `요청 확인 실패: ${waitError.message}`);
    }
    if ((waiting ?? []).length > 0) return fail("이 사람의 앞 요청을 봇이 처리하는 중입니다. 잠시 뒤 다시 해 주세요.");

    const { data, error } = await admin
      .from("point_adjustments")
      .insert({
        uid,
        name: target.name,
        points,
        tickets,
        reason: reason || null,
        admin_member: auth.memberId,
        admin_name: manager.name,
      })
      .select("id")
      .single();
    if (error) return fail(`요청 실패: ${error.message}`);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "status") {
    const id = typeof body.id === "string" ? body.id : "";
    const { data } = await admin
      .from("point_adjustments")
      .select("id,state,error,exp_after,tickets_after")
      .eq("id", id)
      .maybeSingle();
    if (!data) return fail("요청을 찾지 못했습니다.", 404);
    return NextResponse.json({ ok: true, adjustment: data });
  }

  return fail("알 수 없는 요청입니다.");
}
