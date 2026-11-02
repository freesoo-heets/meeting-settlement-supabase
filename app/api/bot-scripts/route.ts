import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId } from "../../../lib/gameServer";

/*
 * 🤖 봇 스크립트 관리 API (관리자만)
 *  · list · read · changes(적용 대기 · 적용 기록) · save(추가 · 수정) · remove · revert(고친 내용 취소)
 *  · about: 파일 설명 저장 (코드가 아니라서 봇 적용 없이 바로 반영). 비우면 기본 설명으로 돌아간다
 *  · resolve: 초안을 만든 뒤 파일이 직접 수정된 충돌 표시를 지운다 (초안을 그대로 쓰기로 함)
 *  · export: PC 사본 (키가 가려진 상태). PC 의 bot_pull.py 로 맞춘다
 *  · 여기서는 초안만 바뀐다. 실제 파일은 운영진방 !봇적용 또는 run(적용 · 되돌리기 · 다시 올리기 요청) 때 봇이 고친다 (봇 bot_updater.py)
 *    run 은 bot_commands 에 넣고 봇이 처리한다. 요청할 때마다 운영진방에 알림이 올라간다
 */

const NAME = /^[A-Za-z0-9_-]+\.py$/;
const MAX_SIZE = 400000; // 봇 bot_updater.py 와 같게
const KEEP_FILES = new Set(["irispy.py"]); // 지울 수 없다
// 화면에 보여 주지 않는다 (봇 bot_updater.py HIDDEN 과 같게). 고치다 망가지면 사이트로 되돌릴 수 없는 파일 · 운영진 권한
const HIDDEN = ["bot_guard.py", "bot_updater.py", "admin_helper.py"];
const NOT_HIDDEN = `(${HIDDEN.map((name) => `"${name}"`).join(",")})`;
const ABOUT_MAX = 100;
const LOG_LIMIT = 30;
const RUN_LIMIT = 20;
const COMMANDS = new Set(["apply", "revert", "upload"]);
const COMMAND_WAIT_MS = 3 * 60 * 1000; // 봇이 처리 중인 요청이 있으면 이 시간 동안 새 요청을 받지 않는다
const COMMAND_COLUMNS = "id,action,state,result,created_at";
const MISSING = "봇관리 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)";

async function clearConflict(admin: ReturnType<typeof getServerAdmin>, name: string) {
  await admin.from("bot_script_meta").update({ conflict: false }).eq("name", name); // 표가 없어도 저장은 된다
}

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
      .not("name", "in", NOT_HIDDEN)
      .order("name");
    if (error) return fail(/bot_scripts/.test(error.message) ? MISSING : error.message);
    const { data: abouts } = await admin.from("bot_script_about").select("name,about"); // 표가 없어도 목록은 보여 준다
    const aboutOf = new Map((abouts ?? []).map((row) => [row.name as string, row.about as string]));
    const { data: metas } = await admin.from("bot_script_meta").select("name,file_at,conflict");
    const metaOf = new Map((metas ?? []).map((row) => [row.name as string, row]));
    return NextResponse.json({
      ok: true,
      rows: (data ?? []).map((row) => ({ ...row, about: aboutOf.get(row.name) ?? null, file_at: metaOf.get(row.name)?.file_at ?? null, conflict: !!metaOf.get(row.name)?.conflict })),
    });
  }

  // 💾 PC 사본: 지금 봇이 쓰는 내용 (live)
  if (action === "export") {
    const { data, error } = await admin.from("bot_scripts").select("name,live").not("live", "is", null).not("name", "in", NOT_HIDDEN).order("name");
    if (error) return fail(/bot_scripts/.test(error.message) ? MISSING : error.message);
    const { data: metas } = await admin.from("bot_script_meta").select("name,file_at");
    const atOf = new Map((metas ?? []).map((row) => [row.name as string, row.file_at as string]));
    return NextResponse.json({ ok: true, export: { exported_at: new Date().toISOString(), rows: (data ?? []).map((row) => ({ ...row, file_at: atOf.get(row.name) ?? null })) } });
  }

  // ▶️ 적용 · 되돌리기 · 다시 올리기 (봇이 3초마다 확인해서 처리한다)
  if (action === "run") {
    const command = String(body.command ?? "");
    if (!COMMANDS.has(command)) return fail("알 수 없는 요청입니다.");
    const since = new Date(Date.now() - COMMAND_WAIT_MS).toISOString();
    const { data: running, error: checkError } = await admin.from("bot_commands").select("id").in("state", ["requested", "running"]).gte("created_at", since).limit(1);
    if (checkError) return fail(/bot_commands/.test(checkError.message) ? MISSING : checkError.message);
    if (running?.length) return NextResponse.json({ ok: false, id: running[0].id, error: "봇이 앞선 요청을 처리하는 중이에요." }); // 화면이 그 요청을 이어서 보여 준다
    const member = await loadMember(admin, auth.memberId);
    if ("error" in member) return fail(member.error, member.status);
    const { data, error } = await admin.from("bot_commands").insert({ action: command, member_id: member.id, requested_by: member.name }).select("id").single();
    if (error) return fail(error.message);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "runStatus") {
    const { data } = await admin.from("bot_commands").select(COMMAND_COLUMNS).eq("id", String(body.id ?? "")).maybeSingle();
    return data ? NextResponse.json({ ok: true, command: data }) : fail("요청을 찾지 못했어요.", 404);
  }

  // 새로고침해도 진행 중인 요청을 이어서 보여 준다
  if (action === "runActive") {
    const since = new Date(Date.now() - COMMAND_WAIT_MS).toISOString();
    const { data } = await admin.from("bot_commands").select(COMMAND_COLUMNS).in("state", ["requested", "running"]).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    return NextResponse.json({ ok: true, command: data?.[0] ?? null });
  }

  // 봇이 받지 않은 요청 · 시간이 지나도 끝나지 않은 요청을 치운다
  if (action === "runCancel") {
    const id = String(body.id ?? "");
    const { data } = await admin.from("bot_commands").select("state,created_at").eq("id", id).maybeSingle();
    if (!data) return fail("요청을 찾지 못했어요.", 404);
    const stuck = Date.now() - new Date(data.created_at as string).getTime() > COMMAND_WAIT_MS;
    if (data.state !== "requested" && !(data.state === "running" && stuck)) return fail("봇이 처리 중이라 취소할 수 없어요.");
    const { error } = await admin.from("bot_commands").update({ state: "failed", result: "사이트에서 요청을 취소했습니다.", updated_at: new Date().toISOString() }).eq("id", id).eq("state", data.state as string);
    return error ? fail(error.message) : NextResponse.json({ ok: true });
  }

  // 📜 변경 내역: 파일 이름이 있으면 그 파일만
  if (action === "changes") {
    const logQuery = admin.from("bot_script_log").select("id,name,action,diff,plus,minus,edited_by,applied_by,applied_at").order("applied_at", { ascending: false }).not("name", "in", NOT_HIDDEN).limit(LOG_LIMIT);
    const pendingQuery = admin.from("bot_scripts").select("name,content,live,changed,deleted,is_new,updated_at").eq("changed", true).not("name", "in", NOT_HIDDEN).order("name");
    const runQuery = admin.from("bot_commands").select("id,action,state,result,requested_by,created_at").order("created_at", { ascending: false }).limit(RUN_LIMIT);
    const [pending, log, runs] = await Promise.all([name ? pendingQuery.eq("name", name) : pendingQuery, name ? logQuery.eq("name", name) : logQuery, runQuery]);
    if (pending.error) return fail(/bot_scripts/.test(pending.error.message) ? MISSING : pending.error.message);
    return NextResponse.json({ ok: true, pending: pending.data ?? [], log: log.data ?? [], runs: runs.data ?? [] });
  }

  if (!NAME.test(name)) return fail("영문 · 숫자 · _ · - 로 된 .py 파일 이름만 쓸 수 있어요.");
  if (HIDDEN.includes(name)) return fail("보호된 파일이라 사이트에서 다룰 수 없어요.", 403);

  if (action === "read") {
    const { data } = await admin.from("bot_scripts").select("name,content,live,changed,deleted,is_new,updated_at").eq("name", name).maybeSingle();
    return data ? NextResponse.json({ ok: true, script: data }) : fail("파일을 찾지 못했어요.", 404);
  }

  const member = await loadMember(admin, auth.memberId);
  if ("error" in member) return fail(member.error, member.status);
  const now = new Date().toISOString();

  if (action === "about") {
    const about = String(body.about ?? "").trim().slice(0, ABOUT_MAX);
    const { error } = about
      ? await admin.from("bot_script_about").upsert({ name, about, updated_by: member.name, updated_at: now }, { onConflict: "name" })
      : await admin.from("bot_script_about").delete().eq("name", name);
    if (error) return fail(/bot_script_about/.test(error.message) ? "파일 설명 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)" : error.message);
    return NextResponse.json({ ok: true });
  }

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
    await clearConflict(admin, name); // 충돌을 보고 고쳐서 저장했다
    return NextResponse.json({ ok: true, updatedAt: now });
  }

  if (action === "resolve") {
    await clearConflict(admin, name);
    return NextResponse.json({ ok: true });
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
    if (error) return fail(error.message);
    if (action === "revert") await clearConflict(admin, name);
    return NextResponse.json({ ok: true });
  }

  return fail("알 수 없는 요청입니다.");
}
