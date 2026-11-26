import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../../lib/server-admin";

const respond = (data: object, status = 200) => NextResponse.json(data, {
  status, headers: { "Cache-Control": "private, no-store" }
});
const fail = (error: string, status: number) => respond({ ok: false, error }, status);

async function requireOwner(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { response: fail("로그인이 필요합니다.", 401) };
  const db = getServerAdmin();
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return { response: fail("세션이 유효하지 않습니다.", 401) };
  const { data: profile, error: pError } = await db.from("profiles")
    .select("id,role,nickname").eq("id", user.id).maybeSingle();
  if (pError || profile?.role !== "owner") return { response: fail("방장만 운영진 카카오 ID를 연결할 수 있습니다.", 403) };
  return { db, profile };
}
export async function GET(request: Request) {
  try {
    const auth = await requireOwner(request);
    if (auth.response) return auth.response;
    const db = auth.db!;
    const [{ data: operators, error: opError }, { data: profiles, error: pError }] = await Promise.all([
      db.from("jjinchin_feedback_bot_operators").select("kakao_uid,profile_id"),
      db.from("profiles").select("id,nickname,role").in("role", ["owner", "admin"])
    ]);
    if (opError || pError) throw opError || pError;
    const byProfile = new Map((operators || []).map(x => [x.profile_id,x.kakao_uid]));
    return respond({ ok: true, rows: (profiles || []).map(x => ({
      profileId: x.id, nickname: x.nickname, role: x.role, kakaoUid: byProfile.get(x.id) || ""
    })) });
  } catch { return fail("운영진 연결 정보를 읽지 못했습니다.", 500); }
}
export async function PUT(request: Request) {
  try {
    const auth = await requireOwner(request);
    if (auth.response) return auth.response;
    const { db, profile } = auth;
    const body = await request.json().catch(() => ({}));
    const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
    const kakaoUid = typeof body.kakaoUid === "string" ? body.kakaoUid.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(profileId) || kakaoUid.length > 256)
      return fail("회원 또는 카카오 사용자 ID가 올바르지 않습니다.", 400);
    const { data: target, error: tErr } = await db!.from("profiles")
      .select("id,role").eq("id", profileId).maybeSingle();
    if (tErr || !target || !["owner", "admin"].includes(target.role))
      return fail("방장·운영진 계정만 연결할 수 있습니다.", 400);
    // An admin may be mapped but cannot use the bot unless currently assigned.
    const { error: removeErr } = await db!.from("jjinchin_feedback_bot_operators")
      .delete().eq("profile_id", profileId);
    if (removeErr) throw removeErr;
    if (kakaoUid) {
      const { error: insertErr } = await db!.from("jjinchin_feedback_bot_operators").insert({
        profile_id: profileId, kakao_uid: kakaoUid, assigned_by: profile!.id
      });
      if (insertErr) return fail("이미 사용 중인 카카오 사용자 ID이거나 저장에 실패했습니다.", 409);
    }
    return respond({ ok: true });
  } catch { return fail("운영진 연결에 실패했습니다.", 500); }
}
