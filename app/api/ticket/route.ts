import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, loadPlayer, requireMemberId } from "../../../lib/gameServer";
import { TICKET_PRICE } from "../../../lib/wordGame";

/*
 * 🎫 티켓 구매 (카톡 !티켓구매 와 같음)
 *  · buy    → ticket_orders(requested) → 봇이 점수를 빼고 티켓을 넣은 뒤 done (점수가 모자라면 failed)
 *  · status → 내 주문 상태 · 구매 뒤 점수 · 티켓
 */

const TICKET_BUY_MAX = 20;
const STUCK_MS = 2 * 60 * 1000; // 봇이 이만큼 처리 못 한 요청은 새 요청을 막지 않는다

export async function POST(request: Request) {
  const admin = getServerAdmin();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;

  if (action === "buy") {
    const count = Math.floor(Number(body.count));
    if (!(count >= 1 && count <= TICKET_BUY_MAX)) return fail(`1~${TICKET_BUY_MAX}장까지 살 수 있습니다.`);
    const { data: waiting } = await admin
      .from("ticket_orders")
      .select("id,created_at")
      .eq("member_id", memberId)
      .in("state", ["requested", "processing"])
      .order("created_at", { ascending: false })
      .limit(1);
    const last = waiting?.[0];
    if (last && Date.now() - new Date(last.created_at as string).getTime() < STUCK_MS) {
      return fail("앞의 구매 요청을 처리하는 중입니다. 잠시만 기다려 주세요.");
    }
    const player = await loadPlayer(admin, memberId);
    if ("error" in player) return fail(player.error, player.status);
    const cost = count * TICKET_PRICE;
    if (player.exp < cost) {
      return fail(`점수가 부족합니다. (필요 ${cost.toLocaleString("ko-KR")}점 · 지금 ${player.exp.toLocaleString("ko-KR")}점)`);
    }
    const { data, error } = await admin
      .from("ticket_orders")
      .insert({ member_id: memberId, name: player.name, uid: player.uid, count })
      .select("id")
      .single();
    if (error) {
      const missing = /ticket_orders/.test(error.message) && /exist|schema cache/i.test(error.message);
      return fail(missing ? "티켓 구매 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)" : `구매 요청 실패: ${error.message}`);
    }
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "status") {
    const id = typeof body.id === "string" ? body.id : "";
    const { data } = await admin
      .from("ticket_orders")
      .select("id,member_id,count,state,reason,cost,exp_after,tickets_after")
      .eq("id", id)
      .maybeSingle();
    if (!data || data.member_id !== memberId) return fail("구매 요청을 찾지 못했습니다.", 404);
    return NextResponse.json({ ok: true, order: data });
  }

  return fail("알 수 없는 요청입니다.");
}
