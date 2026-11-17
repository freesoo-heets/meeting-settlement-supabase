import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";

type SupabaseAdmin = ReturnType<typeof getServerAdmin>;
type Verified = { admin: SupabaseAdmin; actorId: string; actorName: string };
type AuthError = { error: string; status: number };

async function authorize(request: Request): Promise<Verified | AuthError> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { error: "로그인이 필요합니다.", status: 401 };
  const admin = getServerAdmin();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { error: "로그인 세션이 유효하지 않습니다.", status: 401 };
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,nickname")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile || !["owner", "admin"].includes(String(profile.role))) {
    return { error: "운영자 권한이 필요합니다.", status: 403 };
  }
  return { admin, actorId: user.id, actorName: String(profile.nickname || user.id) };
}

const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export async function GET(request: Request) {
  try {
    const auth = await authorize(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!validMonth(month)) return NextResponse.json({ error: "조회 월이 올바르지 않습니다." }, { status: 400 });

    // 관리자에게만 사용자 식별자를 제공하며 공개 RPC는 닉네임 집계만 반환합니다.
    const totals = new Map<string, { kakao_uid: string; nickname: string; support_count: number; points_total: number }>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await auth.admin
        .from("monthly_support_events")
        .select("kakao_uid,nickname,points_awarded")
        .eq("month_key", month)
        .is("deleted_at", null)
        .order("id", { ascending: false })
        .range(offset, offset + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const entry of data ?? []) {
        const uid = String(entry.kakao_uid);
        const current = totals.get(uid) || { kakao_uid: uid, nickname: String(entry.nickname), support_count: 0, points_total: 0 };
        current.support_count += 1;
        current.points_total += Number(entry.points_awarded);
        totals.set(uid, current);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    const rows = [...totals.values()].sort((a,b) => b.support_count - a.support_count || b.points_total - a.points_total || a.nickname.localeCompare(b.nickname, "ko"));
    return NextResponse.json({ ok: true, rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "후원 기록 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await authorize(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const month = typeof body.month === "string" ? body.month.trim() : "";
    const uid = typeof body.uid === "string" ? body.uid.trim() : "";
    const confirm = body.confirm === "DELETE_MONTH_SUPPORT";
    if (!validMonth(month) || !uid || uid.length > 256 || !confirm) {
      return NextResponse.json({ error: "삭제 대상과 확인 값이 올바르지 않습니다." }, { status: 400 });
    }
    // 기록을 가리고 관리자 감사 필드를 남깁니다. 회원·점수·메달·원본 보상 회차는 변경하지 않습니다.
    const { data, error } = await auth.admin.rpc("hide_monthly_support_member", {
      p_month: month, p_kakao_uid: uid, p_actor: auth.actorId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: Number(data?.removed ?? 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "후원 기록 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
