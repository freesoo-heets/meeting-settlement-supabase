import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId, type Admin } from "../../../lib/gameServer";
import { MEDAL_MAX, POINT_ADMIN_MAX, TICKET_ADMIN_MAX, REASON_MAX } from "../../../lib/pointAdmin";

/*
 * ⚙️ 관리자 점수 · 티켓 · 메달 조정 (카톡 !점수추가 · !점수감소 · !티켓추가 · !티켓감소 · !메달추가 · !메달삭제 와 같음)
 *  · adjust → 점수 · 티켓. point_adjustments(requested) → 봇이 점수판에 반영한 뒤 done (대상을 못 찾으면 failed)
 *  · medal  → 메달 하나 추가(add) 또는 삭제(remove). 같은 길로 처리한다
 *  · status → 요청 상태 · 반영 뒤 점수 · 티켓 · 메달
 */

type Change = { points: number; tickets: number; reason: string | null; medal_add: string | null; medal_remove: string | null };

async function enqueue(admin: Admin, memberId: string, uid: string, change: Change) {
  const manager = await loadMember(admin, memberId);
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
  if (waitError) return fail(setupError(waitError.message) ?? `요청 확인 실패: ${waitError.message}`);
  if ((waiting ?? []).length > 0) return fail("이 사람의 앞 요청을 봇이 처리하는 중입니다. 잠시 뒤 다시 해 주세요.");

  // 메달 칸이 없는 표(SQL 실행 전)에도 점수 · 티켓 요청은 들어가도록 쓴 칸만 보낸다
  const { medal_add, medal_remove, ...rest } = change;
  const { data, error } = await admin
    .from("point_adjustments")
    .insert({
      uid,
      name: target.name,
      ...rest,
      ...(medal_add ? { medal_add } : {}),
      ...(medal_remove ? { medal_remove } : {}),
      admin_member: memberId,
      admin_name: manager.name,
    })
    .select("id")
    .single();
  if (error) return fail(setupError(error.message) ?? `요청 실패: ${error.message}`);
  return NextResponse.json({ ok: true, id: data.id });
}

function setupError(message: string) {
  return /point_adjustments|medal_/.test(message) && /exist|schema cache|violates check/i.test(message)
    ? "점수 관리 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)"
    : null;
}

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
    return enqueue(admin, auth.memberId, uid, { points, tickets, reason: reason || null, medal_add: null, medal_remove: null });
  }

  if (action === "medal") {
    const uid = typeof body.uid === "string" ? body.uid : "";
    const add = typeof body.add === "string" ? body.add.trim() : "";
    const remove = typeof body.remove === "string" ? body.remove.trim() : "";
    const medal = add || remove;
    if (!medal || (add && remove)) return fail("메달을 입력해 주세요.");
    if (medal.length > MEDAL_MAX || /\s/.test(medal)) return fail(`메달은 띄어쓰기 없이 ${MEDAL_MAX}자까지 쓸 수 있습니다.`);
    return enqueue(admin, auth.memberId, uid, { points: 0, tickets: 0, reason: null, medal_add: add || null, medal_remove: remove || null });
  }

  if (action === "status") {
    const id = typeof body.id === "string" ? body.id : "";
    const { data } = await admin
      .from("point_adjustments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!data) return fail("요청을 찾지 못했습니다.", 404);
    return NextResponse.json({ ok: true, adjustment: data });
  }

  return fail("알 수 없는 요청입니다.");
}
