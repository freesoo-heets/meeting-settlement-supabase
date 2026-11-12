import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId } from "../../../lib/gameServer";

/*
 * 🤖 정산 글 봇 전송 (사이트 '카카오톡 공유하기')
 *  · send   { meetingIds } → settlement_sends 에 넣으면 봇이 몇 초 안에 본방(강서2026)에 태그와 함께 올린다
 *           (한 벙 · 통합 정산 모두. 글은 봇 meeting_settlement.py 가 사이트와 같은 계산으로 만든다)
 *  · status { id }         → 봇이 보냈는지 (sent_at · result)
 *  · 운영진 또는 그 벙(들)의 벙주만. 같은 벙 묶음은 1분 안에 다시 보내지 않는다
 */

const MISSING = "봇 전송 설정이 아직 안 됐어요. (운영진: SQL 실행 필요 · 20261112_settlement_sends.sql)";
const RESEND_MS = 60 * 1000;
const MAX_MEETINGS = 10; // 봇 MULTI_MAX 와 같게
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const admin = getServerAdmin();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "send");

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);

  if (action === "status") {
    const { data, error } = await admin
      .from("settlement_sends")
      .select("id,sent_at,result,requested_by")
      .eq("id", String(body.id ?? ""))
      .maybeSingle();
    if (error) return fail(/settlement_sends/.test(error.message) ? MISSING : error.message);
    if (!data || data.requested_by !== auth.memberId) return fail("요청을 찾지 못했어요.", 404);
    return NextResponse.json({ ok: true, sent_at: data.sent_at, result: data.result });
  }

  if (action !== "send") return fail("알 수 없는 요청입니다.");

  const ids = Array.from(new Set((Array.isArray(body.meetingIds) ? body.meetingIds : []).map(String))).filter((id) => UUID.test(id));
  if (ids.length === 0) return fail("보낼 모임을 골라 주세요.");
  if (ids.length > MAX_MEETINGS) return fail(`한 번에 ${MAX_MEETINGS}개 모임까지 보낼 수 있어요.`);

  const member = await loadMember(admin, auth.memberId);
  if ("error" in member) return fail(member.error, member.status);

  // 벙주 칸이 DB 에 없을 수도 있어 따로 읽는다
  const { data: meetings, error: meetingError } = await admin.from("meetings").select("id,title,cost").in("id", ids);
  if (meetingError) return fail(meetingError.message);
  if ((meetings ?? []).length !== ids.length) return fail("모임을 찾지 못했어요. 새로고침 후 다시 해 주세요.", 404);
  const noCost = (meetings ?? []).find((meeting) => meeting.cost == null);
  if (noCost) return fail(`먼저 '${noCost.title}' 모임 비용을 입력해 주세요.`);

  if (!(await isAdminMember(admin, member.id))) {
    const { data: hosts } = await admin.from("meetings").select("id,host_member").in("id", ids);
    const allMine = (hosts ?? []).length === ids.length && (hosts ?? []).every((row) => row.host_member === member.id);
    if (!allMine) return fail("운영진이나 그 모임의 벙주(👑)만 봇으로 보낼 수 있어요.", 403);
  }

  // 같은 모임 묶음을 방금 보냈거나 아직 봇이 보내는 중이면 다시 넣지 않는다 (두 번 올라가지 않게)
  const key = [...ids].sort().join(",");
  const since = new Date(Date.now() - RESEND_MS).toISOString();
  const { data: recent, error: recentError } = await admin
    .from("settlement_sends")
    .select("id,meeting_ids,sent_at,created_at")
    .or(`sent_at.is.null,created_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (recentError) return fail(/settlement_sends/.test(recentError.message) ? MISSING : recentError.message);
  const same = (recent ?? []).find((row) => [...((row.meeting_ids as string[]) ?? [])].sort().join(",") === key);
  if (same) {
    const pending = !same.sent_at && Date.now() - new Date(same.created_at as string).getTime() < 5 * 60 * 1000;
    if (pending || new Date(same.created_at as string).getTime() >= Date.now() - RESEND_MS) {
      return fail(pending ? "봇이 이 정산을 보내는 중이에요. 잠시만 기다려 주세요." : "방금 보낸 정산이에요. 1분 뒤에 다시 보내 주세요.", 429);
    }
  }

  const { data, error } = await admin
    .from("settlement_sends")
    .insert({ meeting_ids: ids, requested_by: member.id, requested_name: member.name })
    .select("id")
    .single();
  if (error) return fail(/settlement_sends/.test(error.message) ? MISSING : error.message);
  return NextResponse.json({ ok: true, id: data.id });
}
