import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServerAdmin } from "../../../../lib/server-admin";

export const runtime = "nodejs";
const reply = (payload: object, status = 200) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number) => reply({ ok: false, error }, status);
const eq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};
const categories: Record<string, string> = {
  suggestion: "건의사항", complaint: "불편·불만", concern: "고민·갈등", other: "기타 의견"
};
type Db = ReturnType<typeof getServerAdmin>;
async function operator(db: Db, uid: string) {
  if (!uid || uid.length > 256) return null;
  const { data: mapped, error } = await db.from("jjinchin_feedback_bot_operators")
    .select("profile_id").eq("kakao_uid", uid).maybeSingle();
  if (error) throw error;
  if (!mapped) return null;
  const { data: profile, error: pErr } = await db.from("profiles")
    .select("id,nickname,role").eq("id", mapped.profile_id).maybeSingle();
  if (pErr) throw pErr;
  if (!profile) return null;
  if (profile.role === "owner") return profile;
  if (profile.role !== "admin") return null;
  const { data: assigned, error: aErr } = await db.from("jjinchin_feedback_reviewers")
    .select("user_id").eq("user_id", profile.id).maybeSingle();
  if (aErr) throw aErr;
  return assigned ? profile : null;
}
const numberOf = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
const string = (s: unknown) => typeof s === "string" ? s.trim() : "";

export async function POST(request: Request) {
  try {
    const secret = process.env.FEEDBACK_BOT_SECRET || "";
    const room = process.env.FEEDBACK_OPERATOR_ROOM_ID || "";
    const authorization = request.headers.get("authorization") || "";
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!secret || !room || !eq(bearer, secret)) return fail("봇 인증 실패", 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!eq(string(body.roomId), room)) return fail("등록된 운영진방에서만 사용할 수 있습니다.", 403);
    const action = string(body.action);
    const db = getServerAdmin();

    if (action === "poll") {
      const { data, error } = await db.rpc("jjinchin_feedback_claim_outbox");
      if (error) throw error;
      const jobs = [];
      for (const job of data || []) {
        const { data: feedback, error: fErr } = await db.from("jjinchin_feedback")
          .select("id,receipt_no,category,title,content,created_at,status")
          .eq("id", job.feedback_id).maybeSingle();
        if (fErr) throw fErr;
        if (!feedback || (job.kind === "reminder" && feedback.status === "answered")) {
          await db.rpc("jjinchin_feedback_ack_outbox", { p_id: job.id, p_success: true });
          continue;
        }
        const { data: author, error: aErr } = await db.from("jjinchin_feedback_authors")
          .select("nickname_at_submission").eq("feedback_id", feedback.id).maybeSingle();
        if (aErr) throw aErr;
        jobs.push({
          id: job.id, kind: job.kind, receipt: feedback.receipt_no,
          nickname: author?.nickname_at_submission || "회원",
          category: categories[feedback.category] || "기타",
          title: feedback.title, content: feedback.content, createdAt: feedback.created_at,
        });
      }
      return reply({ ok: true, jobs });
    }
    if (action === "ack") {
      const id = string(body.id);
      if (!/^[0-9a-f-]{36}$/i.test(id) || typeof body.success !== "boolean") return fail("잘못된 전송 확인", 400);
      const { data, error } = await db.rpc("jjinchin_feedback_ack_outbox", {
        p_id: id, p_success: body.success, p_error: string(body.error).slice(0, 300) || null
      });
      if (error) throw error;
      return reply({ ok: true, updated: !!data });
    }

    // Only an individually mapped, currently authorized operator can query or reply.
    const uid = string(body.senderUid);
    const actor = await operator(db, uid);
    if (!actor) return fail("소리함 담당 운영진 권한이 없습니다.", 403);

    if (action === "list" || action === "count") {
      const { data, error } = await db.from("jjinchin_feedback")
        .select("receipt_no,category,title,status,created_at")
        .in("status", ["received","reviewing"]).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return reply({ ok: true, rows: action === "count" ? [] : data || [], count: (data || []).length, limited: (data || []).length === 20 });
    }
    if (action === "detail") {
      const receipt = numberOf(body.receipt);
      if (!receipt) return fail("접수번호를 확인해주세요.", 400);
      const { data: f, error } = await db.from("jjinchin_feedback")
        .select("id,receipt_no,category,title,content,status,created_at")
        .eq("receipt_no",receipt).maybeSingle();
      if (error) throw error;
      if (!f) return fail("접수 내역이 없습니다.", 404);
      const { data: author, error: aErr } = await db.from("jjinchin_feedback_authors")
        .select("nickname_at_submission").eq("feedback_id",f.id).maybeSingle();
      if (aErr) throw aErr;
      return reply({ ok: true, item: {
        receipt: f.receipt_no, category: categories[f.category] || "기타", nickname: author?.nickname_at_submission || "회원",
        title: f.title, content: f.content, status: f.status, createdAt: f.created_at
      } });
    }
    if (action === "history") {
      const receipt = numberOf(body.receipt);
      if (!receipt) return fail("접수번호를 확인해주세요.", 400);
      const { data: ticket, error: findError } = await db.from("jjinchin_feedback")
        .select("id,receipt_no").eq("receipt_no", receipt).maybeSingle();
      if (findError) throw findError;
      if (!ticket) return fail("접수 내역이 없습니다.", 404);
      const { data, error } = await db.from("jjinchin_feedback_reply_history")
        .select("content,source,replied_at").eq("feedback_id",ticket.id)
        .order("replied_at",{ascending:false}).limit(10);
      if (error) throw error;
      return reply({ok:true, receipt, history:data||[]});
    }
    if (action === "status") {
      const receipt = numberOf(body.receipt), status = string(body.status);
      if (!receipt || !["reviewing","closed"].includes(status)) return fail("접수번호 또는 처리 상태가 올바르지 않습니다.",400);
      const {data,error} = await db.from("jjinchin_feedback").update({
        status,updated_at:new Date().toISOString()
      }).eq("receipt_no",receipt).select("receipt_no").maybeSingle();
      if (error) throw error;
      if (!data) return fail("접수 내역이 없습니다.",404);
      return reply({ok:true,receipt,status,actor:actor.nickname});
    }
    if (action === "reply") {
      const receipt = numberOf(body.receipt);
      const content = string(body.content), messageId = string(body.messageId);
      if (!receipt || !messageId || messageId.length > 256 || !content || content.length > 4000)
        return fail("접수번호·답변·메시지 ID가 올바르지 않습니다.", 400);
      // DB procedure re-checks operator authorization and records one reply per source message.
      const { data, error } = await db.rpc("jjinchin_feedback_bot_reply", {
        p_kakao_uid: uid, p_receipt: receipt, p_message_id: room + ":" + messageId, p_content: content
      });
      if (error) throw error;
      if (data === "FORBIDDEN") return fail("소리함 담당 운영진 권한이 없습니다.", 403);
      if (data === "NOT_FOUND") return fail("접수 내역이 없습니다.", 404);
      if (data !== "SAVED" && data !== "ALREADY_PROCESSED") return fail("답변을 등록할 수 없습니다.", 400);
      return reply({ ok: true, outcome: data, receipt, actor: actor.nickname });
    }
    return fail("지원하지 않는 명령어입니다.", 400);
  } catch (error) {
    // Do not write message contents or submissions to logs.
    console.error("[FEEDBACK_BOT_API]", error instanceof Error ? error.name : "unknown");
    return fail("봇 소리함 처리 실패", 500);
  }
}
