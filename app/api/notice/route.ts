import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, requireMemberId } from "../../../lib/gameServer";

/**
 * 참석 경고 안내 요청 (관리자 전용)
 *  POST { memberIds: string[] } → member_notices 에 넣으면 봇이 몇 초 안에 카톡방에 멘션으로 올린다
 */
export async function POST(request: Request) {
  const admin = getServerAdmin();
  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  if (!(await isAdminMember(admin, auth.memberId))) return fail("관리자만 보낼 수 있습니다.", 403);

  const body = (await request.json().catch(() => null)) as { memberIds?: unknown } | null;
  const ids = Array.from(new Set((Array.isArray(body?.memberIds) ? body.memberIds : []).map(String))).filter((id) =>
    /^[0-9a-f-]{36}$/i.test(id),
  );
  if (ids.length === 0) return fail("보낼 회원을 골라 주세요.");
  if (ids.length > 80) return fail("한 번에 80명까지 보낼 수 있습니다.");

  // 같은 사람에게 1분 안에 또 보내지 않게
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recent } = await admin.from("member_notices").select("member_ids").gte("created_at", since);
  const recentIds = new Set((recent ?? []).flatMap((row) => (row.member_ids as string[]) ?? []));
  const fresh = ids.filter((id) => !recentIds.has(id));
  if (fresh.length === 0) return fail("방금 보낸 회원입니다. 1분 뒤에 다시 보내 주세요.", 429);

  const { error } = await admin.from("member_notices").insert({ member_ids: fresh, requested_by: auth.memberId });
  if (error) return fail(`요청 실패: ${error.message}`, 500);
  return NextResponse.json({ ok: true, count: fresh.length });
}
