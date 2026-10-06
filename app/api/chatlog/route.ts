import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId } from "../../../lib/gameServer";

/**
 * 회원현황 채팅 정보 (카톡 봇이 member_chat 에 올린 것)
 *  GET /api/chatlog              → 모든 회원의 마지막 채팅 시각 {name: iso}
 *  GET /api/chatlog?name=닉네임   → 그 사람의 최근 채팅 내역 (운영진 또는 본인만)
 */
export async function GET(request: Request) {
  const admin = getServerAdmin();
  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);

  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name) {
    const { data, error } = await admin.from("member_chat").select("name,last_chat_at");
    if (error) return NextResponse.json({ ok: true, last: {} }); // 표가 아직 없으면 빈 값
    const last: Record<string, string> = {};
    for (const row of data ?? []) {
      if (!row.last_chat_at) continue;
      const prev = last[row.name as string];
      if (!prev || prev < (row.last_chat_at as string)) last[row.name as string] = row.last_chat_at as string;
    }
    return NextResponse.json({ ok: true, last });
  }

  const me = await loadMember(admin, auth.memberId);
  if ("error" in me) return fail(me.error, me.status);
  if (me.name !== name && !(await isAdminMember(admin, auth.memberId))) {
    return fail("다른 사람의 채팅 내역은 운영진만 볼 수 있습니다.", 403);
  }
  const { data, error } = await admin
    .from("member_chat")
    .select("name,full_nick,last_chat_at,messages")
    .eq("name", name)
    .order("last_chat_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail("채팅 내역을 불러오지 못했습니다.", 500);
  return NextResponse.json({ ok: true, chat: data ?? null });
}
