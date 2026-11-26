import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";

type Role = "owner" | "admin" | "user";
type Profile = { id: string; nickname: string; role: Role };
type Db = ReturnType<typeof getServerAdmin>;
type Authorized = { db: Db; profile: Profile };
const json = (payload: object, status = 200) => NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
const err = (message: string, status: number) => json({ ok: false, error: message }, status);

async function authenticate(request: Request): Promise<Authorized | Response> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return err("로그인이 필요합니다.", 401);
  const db = getServerAdmin();
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) return err("세션이 만료되었습니다. 다시 로그인해주세요.", 401);
  const { data: profile, error: profileError } = await db.from("profiles").select("id,nickname,role").eq("id", user.id).maybeSingle();
  if (profileError || !profile) return err("회원 프로필이 없습니다.", 403);
  return { db, profile: profile as Profile };
}
async function reviewer(db: Db, profile: Profile) {
  if (profile.role === "owner") return true;
  if (profile.role !== "admin") return false;
  const { data, error } = await db.from("jjinchin_feedback_reviewers").select("user_id").eq("user_id", profile.id).maybeSingle();
  if (error) throw error;
  return !!data;
}
const categories = new Set(["suggestion", "complaint", "concern", "other"]);
const statuses = new Set(["received", "reviewing", "answered", "closed"]);
const uuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const string = (s: unknown) => typeof s === "string" ? s.trim() : "";

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;
    const { db, profile } = auth;
    const isReviewer = await reviewer(db, profile);
    const { data: owned, error: ownError } = await db.from("jjinchin_feedback_authors").select("feedback_id").eq("user_id", profile.id).limit(200);
    if (ownError) throw ownError;
    const ids = (owned || []).map(x => x.feedback_id);
    let myItems: Record<string, unknown>[] = [];
    if (ids.length) {
      const { data, error } = await db.from("jjinchin_feedback").select("id,receipt_no,category,title,content,anonymous,status,created_at,updated_at,jjinchin_feedback_replies(content,replied_at),jjinchin_feedback_reply_history(content,replied_at,source)").in("id", ids).order("created_at", { ascending: false });
      if (error) throw error;
      myItems = data || [];
    }
    let inbox: Record<string, unknown>[] = [];
    if (isReviewer) {
      const { data, error } = await db.from("jjinchin_feedback").select("id,receipt_no,category,title,content,anonymous,status,created_at,updated_at,jjinchin_feedback_replies(content,replied_at),jjinchin_feedback_reply_history(content,replied_at,source)").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      inbox = data || [];
      // 실명으로 접수한 글만 닉네임을 결합한다. 익명 글의 작성자 ID는 응답에 포함하지 않는다.
      const namedIds = inbox.filter(x => !x.anonymous).map(x => String(x.id));
      if (namedIds.length) {
        const { data: names, error: namesError } = await db.from("jjinchin_feedback_authors").select("feedback_id,nickname_at_submission").in("feedback_id", namedIds);
        if (namesError) throw namesError;
        const map = new Map((names || []).map(x => [x.feedback_id, x.nickname_at_submission]));
        inbox = inbox.map(x => ({ ...x, author: x.anonymous ? "익명" : map.get(x.id as string) || "회원" }));
      } else inbox = inbox.map(x => ({ ...x, author: "익명" }));
    }
    let admins: { id: string; nickname: string; selected: boolean }[] = [];
    if (profile.role === "owner") {
      const [{ data: candidates, error: candidateError }, { data: assigned, error: assignedError }] = await Promise.all([
        db.from("profiles").select("id,nickname").eq("role", "admin"),
        db.from("jjinchin_feedback_reviewers").select("user_id"),
      ]);
      if (candidateError || assignedError) throw candidateError || assignedError;
      const selected = new Set((assigned || []).map(x => x.user_id));
      admins = (candidates || []).map(x => ({ id: x.id, nickname: x.nickname, selected: selected.has(x.id) }));
    }
    return json({ ok: true, currentNickname: profile.nickname, mine: myItems, inbox, isReviewer, isOwner: profile.role === "owner", admins });
  } catch (e) {
    console.error("[FEEDBACK_GET]", e);
    return err("소리함을 불러오지 못했습니다. 데이터베이스 설정을 확인해주세요.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;
    const body = await request.json().catch(() => ({}));
    const category = string(body.category);
    const title = string(body.title);
    const content = string(body.content);
    if (!categories.has(category) || title.length < 2 || title.length > 120 || content.length < 5 || content.length > 4000 || body.anonymous === true) {
      return err("익명 제출은 불가합니다. 분류·제목(2~120자)·내용(5~4000자)을 확인해주세요.", 400);
    }
    const { db, profile } = auth;
    // 익명 제출 요청은 API에서 거부한다. 작성자는 로그인 프로필에서만 결정한다.
    // 닉네임은 제출자가 입력하지 않고 로그인한 profiles.nickname을 기준으로 기록한다.
    if (!profile.nickname?.trim()) return err("로그인 계정에 닉네임이 없습니다. 회원 정보를 확인해주세요.", 409);
    const { data: entry, error: insertError } = await db.from("jjinchin_feedback")
      .insert({ category, title, content, anonymous: false }).select("id").single();
    if (insertError || !entry) throw insertError || Error("저장할 수 없습니다.");
    const { error: authorError } = await db.from("jjinchin_feedback_authors")
      .insert({ feedback_id: entry.id, user_id: profile.id, nickname_at_submission: profile.nickname });
    if (authorError) {
      // 작성자 연결 실패 시 본문도 반드시 제거한다.
      await db.from("jjinchin_feedback").delete().eq("id", entry.id);
      throw authorError;
    }
    return json({ ok: true, id: entry.id }, 201);
  } catch (e) {
    console.error("[FEEDBACK_POST]", e);
    return err("의견 저장에 실패했습니다.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;
    const { db, profile } = auth;
    if (!(await reviewer(db, profile))) return err("지정된 소리함 운영진만 처리할 수 있습니다.", 403);
    const body = await request.json().catch(() => ({}));
    if (!uuid(body.id)) return err("접수번호가 올바르지 않습니다.", 400);
    const status = string(body.status);
    const reply = string(body.reply);
    if (!statuses.has(status) || reply.length > 4000) return err("처리 상태 또는 답변 내용이 올바르지 않습니다.", 400);
    if (status === "answered" && !reply) return err("답변완료 시 답변을 입력해주세요.", 400);
    if (reply) {
      const { error } = await db.from("jjinchin_feedback_replies").upsert({
        feedback_id: body.id, content: reply, replied_by: profile.id, replied_at: new Date().toISOString()
      }, { onConflict: "feedback_id" });
      if (error) throw error;
    }
    const { data, error } = await db.from("jjinchin_feedback")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", body.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return err("접수 내역이 없습니다.", 404);
    return json({ ok: true });
  } catch (e) {
    console.error("[FEEDBACK_PATCH]", e);
    return err("처리에 실패했습니다.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;
    const { db, profile } = auth;
    if (profile.role !== "owner") return err("방장만 담당 운영진을 지정할 수 있습니다.", 403);
    const body = await request.json().catch(() => ({}));
    if (!uuid(body.userId) || typeof body.enabled !== "boolean") return err("대상 정보가 올바르지 않습니다.", 400);
    const { data: candidate, error: candidateError } = await db.from("profiles").select("id,role").eq("id", body.userId).maybeSingle();
    if (candidateError || !candidate || candidate.role !== "admin") return err("관리자 권한을 가진 회원만 지정할 수 있습니다.", 400);
    if (body.enabled) {
      const { error } = await db.from("jjinchin_feedback_reviewers").upsert({ user_id: body.userId, assigned_by: profile.id }, { onConflict: "user_id" });
      if (error) throw error;
    } else {
      const { error } = await db.from("jjinchin_feedback_reviewers").delete().eq("user_id", body.userId);
      if (error) throw error;
    }
    return json({ ok: true });
  } catch (e) {
    console.error("[FEEDBACK_REVIEWERS]", e);
    return err("담당 운영진 변경에 실패했습니다.", 500);
  }
}
