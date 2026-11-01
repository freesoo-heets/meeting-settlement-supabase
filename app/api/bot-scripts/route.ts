import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId } from "../../../lib/gameServer";

/*
 * 🤖 봇 스크립트 관리 API (관리자만)
 *  · list · read · save(추가 · 수정) · remove · revert(고친 내용 취소)
 *  · 여기서는 초안만 바뀐다. 실제 파일은 운영진방 !봇적용 때 봇이 고친다 (봇 bot_updater.py)
 */

const NAME = /^[A-Za-z0-9_-]+\.py$/;
const MAX_SIZE = 400000; // 봇 bot_updater.py 와 같게
const KEEP_FILES = new Set(["irispy.py", "bot_updater.py"]); // 지울 수 없다
const HIDDEN = "bot_guard.py"; // 자동 복구 장치라 고칠 수 없다
const MISSING = "봇관리 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)";

export async function POST(request: Request) {
  const admin = getServerAdmin();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const name = String(body.name ?? "").trim();

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  if (!(await isAdminMember(admin, auth.memberId))) return fail("관리자만 쓸 수 있어요.", 403);

  if (action === "list") {
    const { data, error } = await admin
      .from("bot_scripts")
      .select("name,size,changed,deleted,is_new,updated_by,updated_at")
      .order("name");
    if (error) return fail(/bot_scripts/.test(error.message) ? MISSING : error.message);
    return NextResponse.json({ ok: true, rows: data ?? [] });
  }

  if (!NAME.test(name) || name === HIDDEN) return fail("영문 · 숫자 · _ · - 로 된 .py 파일 이름만 쓸 수 있어요.");

  if (action === "read") {
    const { data } = await admin.from("bot_scripts").select("name,content,changed,deleted,is_new,updated_at").eq("name", name).maybeSingle();
    return data ? NextResponse.json({ ok: true, script: data }) : fail("파일을 찾지 못했어요.", 404);
  }

  const member = await loadMember(admin, auth.memberId);
  if ("error" in member) return fail(member.error, member.status);
  const now = new Date().toISOString();

  if (action === "save") {
    const content = String(body.content ?? "");
    if (!content.trim()) return fail("내용이 비어 있어요.");
    if (new TextEncoder().encode(content).length > MAX_SIZE) return fail("파일이 너무 커요. (400KB 까지)");
    const row = { content, deleted: false, updated_by: member.name, updated_at: now };
    if (body.expected === null) {
      const { error } = await admin.from("bot_scripts").insert({ name, ...row });
      if (error) return fail(error.code === "23505" ? "같은 이름의 파일이 이미 있어요." : error.message);
      return NextResponse.json({ ok: true, updatedAt: now });
    }
    // 다른 관리자가 그사이 고쳤으면 덮어쓰지 않는다
    const { data, error } = await admin.from("bot_scripts").update(row).eq("name", name).eq("updated_at", String(body.expected)).select("name");
    if (error) return fail(error.message);
    if (!data?.length) return fail("다른 곳에서 먼저 고쳤어요. 다시 열어서 확인해 주세요.");
    return NextResponse.json({ ok: true, updatedAt: now });
  }

  const { data: row } = await admin.from("bot_scripts").select("live").eq("name", name).maybeSingle();
  if (!row) return fail("파일을 찾지 못했어요.", 404);

  if (action === "remove" || action === "revert") {
    if (action === "remove" && KEEP_FILES.has(name)) return fail("이 파일은 지울 수 없어요.");
    // 아직 봇에 없는 새 파일은 초안만 지우면 끝
    if (row.live === null) {
      const { error } = await admin.from("bot_scripts").delete().eq("name", name);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    const change = action === "remove" ? { deleted: true } : { deleted: false, content: row.live as string };
    const { error } = await admin.from("bot_scripts").update({ ...change, updated_by: member.name, updated_at: now }).eq("name", name);
    return error ? fail(error.message) : NextResponse.json({ ok: true });
  }

  return fail("알 수 없는 요청입니다.");
}
