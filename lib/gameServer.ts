import { NextResponse } from "next/server";
import { getServerAdmin } from "./server-admin";

// 게임 API 공통 (서버 전용)

export type Admin = ReturnType<typeof getServerAdmin>;
export type Player = { memberId: string; name: string; uid: string; exp: number; tickets: number };
type Fail = { error: string; status: number };

export function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// 로그인 → 회원 id
export async function requireMemberId(request: Request, admin: Admin): Promise<{ memberId: string } | Fail> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { error: "로그인이 필요합니다.", status: 401 };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { error: "로그인 세션이 유효하지 않습니다.", status: 401 };

  const { data: profile } = await admin.from("profiles").select("member_id").eq("id", userData.user.id).maybeSingle();
  if (!profile?.member_id) return { error: "회원 명단과 연결된 계정만 할 수 있습니다.", status: 403 };
  return { memberId: profile.member_id as string };
}

export async function loadMember(admin: Admin, memberId: string): Promise<{ id: string; name: string } | Fail> {
  const { data: member } = await admin.from("members").select("id,name,active").eq("id", memberId).maybeSingle();
  if (!member || !member.active) return { error: "활동 중인 회원만 할 수 있습니다.", status: 403 };
  return { id: member.id, name: member.name };
}

// 점수 내기 게임용: 봇 점수판의 점수·티켓까지
export async function loadPlayer(admin: Admin, memberId: string): Promise<Player | Fail> {
  const member = await loadMember(admin, memberId);
  if ("error" in member) return member;

  const normalize = (value: string) => value.split(" ").join("").toLowerCase();
  const { data } = await admin.from("bot_points").select("kakao_uid,name,exp,tickets");
  const rows = (data ?? []).filter((row) => normalize(row.name) === normalize(member.name));
  rows.sort((a, b) => b.exp - a.exp);
  const point = rows[0];
  if (!point) return { error: "카톡 봇 점수판에서 회원님을 찾지 못했습니다. (닉네임 확인)", status: 403 };

  return { memberId: member.id, name: member.name, uid: point.kakao_uid, exp: point.exp, tickets: point.tickets };
}

export async function hasActiveStakeGame(admin: Admin, table: string, memberId: string) {
  const { data } = await admin
    .from(table)
    .select("id")
    .in("status", ["open", "challenge", "escrow", "playing"])
    .or(`host_member.eq.${memberId},guest_member.eq.${memberId}`)
    .limit(1);
  return (data ?? []).length > 0;
}

// updated_at 이 그대로일 때만 고친다 (동시에 두 요청이 와도 한쪽만 반영)
export async function updateIfUnchanged(
  admin: Admin,
  table: string,
  row: { id: string; updated_at: string },
  fields: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from(table)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select("id");
  return !error && (data ?? []).length === 1;
}

// 관리자(owner·admin)인지 — 게임 테스트 모드용
export async function isAdminMember(admin: Admin, memberId: string) {
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("member_id", memberId)
    .in("role", ["owner", "admin"])
    .limit(1);
  return (data ?? []).length > 0;
}

// 카톡방 초대 메시지 요청 (봇이 bot_announcements 를 보고 올린다). 같은 대국은 1분에 한 번
export const INVITE_COOLDOWN_MS = 60 * 1000;
export async function requestInvite(admin: Admin, kind: "omok" | "alkkagi", refId: string, memberId: string) {
  const { data: last } = await admin
    .from("bot_announcements")
    .select("created_at")
    .eq("ref_id", refId)
    .order("created_at", { ascending: false })
    .limit(1);
  const lastAt = last?.[0]?.created_at ? new Date(last[0].created_at as string).getTime() : 0;
  const wait = Math.ceil((lastAt + INVITE_COOLDOWN_MS - Date.now()) / 1000);
  if (wait > 0) return { ok: false as const, error: `방금 보냈어요. ${wait}초 뒤에 다시 보낼 수 있습니다.` };
  const { error } = await admin.from("bot_announcements").insert({ kind, ref_id: refId, requested_by: memberId });
  if (error) return { ok: false as const, error: `요청 실패: ${error.message}` };
  return { ok: true as const };
}
