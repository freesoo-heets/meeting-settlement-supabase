"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Category = "suggestion" | "complaint" | "concern" | "other";
type Status = "received" | "reviewing" | "answered" | "closed";
type Feedback = {
  id: string; receipt_no?: number; category: Category; title: string; content: string;
  anonymous: boolean; status: Status; created_at: string;
  author?: string; jjinchin_feedback_reply_history?: { content: string; replied_at: string; source: string }[]; jjinchin_feedback_replies?: { content: string; replied_at: string }[] | { content: string; replied_at: string } | null;
};
type Admin = { id: string; nickname: string; selected: boolean };
type Payload = { ok: boolean; currentNickname: string; mine: Feedback[]; inbox: Feedback[]; isReviewer: boolean; isOwner: boolean; admins: Admin[]; error?: string };
const categoryLabels: Record<Category, string> = { suggestion: "건의사항", complaint: "불편·불만", concern: "고민·갈등", other: "기타 의견" };
const statusLabels: Record<Status, string> = { received: "접수", reviewing: "검토중", answered: "답변완료", closed: "종결" };
const fieldStyle = { width: "100%", boxSizing: "border-box" as const, padding: 13, border: "1px solid #d8dce7", borderRadius: 12, fontSize: 16, color: "#202638", background: "#fff" };
const boxStyle = { background: "#fff", borderRadius: 18, border: "1px solid #e4e7f0", padding: 18, marginBottom: 14 };
const buttonStyle = { border: 0, borderRadius: 12, background: "#4059ac", color: "white", padding: "12px 16px", fontSize: 15, fontWeight: 700 as const, cursor: "pointer" };
const replyOf = (item: Feedback) => Array.isArray(item.jjinchin_feedback_replies) ? item.jjinchin_feedback_replies[0] : item.jjinchin_feedback_replies;

export default function FeedbackPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [category, setCategory] = useState<Category>("suggestion");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [activeTab, setActiveTab] = useState<"write" | "mine" | "inbox">("write");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, { status: Status; reply: string }>>({});

  const callApi = useCallback(async (method: "GET" | "POST" | "PATCH" | "PUT", body?: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("모임페이지에 먼저 로그인해주세요.");
    const response = await fetch("/api/feedback", {
      method, cache: "no-store",
      headers: { Authorization: "Bearer " + session.access_token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
    return result;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi("GET") as Payload;
      setPayload(data);
      setEdits(Object.fromEntries(data.inbox.map(item => [item.id, { status: item.status, reply: replyOf(item)?.content || "" }])));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "조회에 실패했습니다.");
    } finally { setLoading(false); }
  }, [callApi]);
  useEffect(() => { void reload(); }, [reload]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      await callApi("POST", { category, title: title.trim(), content: content.trim() });
      setTitle(""); setContent(""); setNotice("의견이 접수되었습니다. 비공개 답변은 '내 접수내역'에서 확인할 수 있습니다.");
      setActiveTab("mine"); await reload();
    } catch (e) { setNotice(e instanceof Error ? e.message : "제출에 실패했습니다."); }
    finally { setBusy(false); }
  }
  async function save(item: Feedback) {
    setBusy(true); setNotice("");
    try {
      const edit = edits[item.id];
      await callApi("PATCH", { id: item.id, ...edit });
      setNotice("처리 내용이 비공개로 저장되었습니다."); await reload();
    } catch (e) { setNotice(e instanceof Error ? e.message : "저장에 실패했습니다."); }
    finally { setBusy(false); }
  }
  async function assign(userId: string, enabled: boolean) {
    setBusy(true); setNotice("");
    try {
      await callApi("PUT", { userId, enabled });
      setNotice("담당 운영진 권한을 변경했습니다."); await reload();
    } catch (e) { setNotice(e instanceof Error ? e.message : "권한 변경에 실패했습니다."); }
    finally { setBusy(false); }
  }

  return <main style={{ minHeight: "100vh", background: "#f7f8fc", color: "#202638", padding: "20px 14px 70px" }}>
    <div style={{ maxWidth: 760, margin: "auto" }}>
      <Link href="/" style={{ display: "inline-block", color: "#4059ac", marginBottom: 22, fontWeight: 700, textDecoration: "none" }}>← 모임관리로 돌아가기</Link>
      <header style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: "#667085" }}>JJINCHIN · PRIVATE FEEDBACK</div>
        <h1 style={{ fontSize: "clamp(26px,5vw,36px)", margin: "8px 0" }}>💌 찐친 소리함</h1>
        <p style={{ color: "#667085", lineHeight: 1.7, margin: 0 }}>작은 불편, 운영 건의, 말하기 어려운 고민까지 편하게 남겨주세요. 작성자 닉네임은 현재 로그인 계정에서 자동으로 연결되며 익명 작성은 지원하지 않습니다.</p>
      </header>
      <nav aria-label="소리함 메뉴" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {([["write", "의견 남기기"], ["mine", "내 접수내역"], ...(payload?.isReviewer ? [["inbox", "운영진 접수함"]] : [])] as [typeof activeTab, string][]).map(([key, label]) =>
          <button key={key} type="button" aria-current={activeTab === key ? "page" : undefined} onClick={() => { setActiveTab(key); setNotice(""); }} style={{ ...buttonStyle, background: activeTab === key ? "#4059ac" : "#e7ebf6", color: activeTab === key ? "#fff" : "#27345a" }}>{label}{key === "inbox" && payload ? " (" + payload.inbox.filter(i => i.status === "received").length + ")" : ""}</button>)}
      </nav>
      {notice && <p role="status" style={{ ...boxStyle, color: "#324a86", overflowWrap: "anywhere" }}>{notice}</p>}
      {loading && <p role="status">내역을 불러오는 중…</p>}
      {!loading && !payload && <section style={boxStyle}>로그인 상태나 데이터베이스 설정을 확인해주세요. <button type="button" onClick={() => void reload()} style={buttonStyle}>다시 시도</button></section>}
      {activeTab === "write" && <form onSubmit={e => void submit(e)} style={boxStyle}>
        <h2 style={{ fontSize: 19, marginTop: 0 }}>어떤 이야기를 남기시나요?</h2>
        <fieldset style={{ border: 0, margin: "0 0 17px", padding: 0 }}>
          <legend style={{ fontWeight: 700, marginBottom: 10 }}>의견 종류</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            {(Object.entries(categoryLabels) as [Category, string][]).map(([key, label]) =>
              <label key={key} style={{ padding: "12px 9px", border: "1px solid " + (category === key ? "#4059ac" : "#d8dce7"), borderRadius: 11, background: category === key ? "#edf1ff" : "white", cursor: "pointer" }}>
                <input type="radio" name="category" checked={category === key} onChange={() => setCategory(key)} /> {label}
              </label>)}
          </div>
        </fieldset>
        <div style={{ marginBottom: 17, padding: 14, borderRadius: 12, background: "#edf1ff" }}>
          <strong style={{ display: "block", marginBottom: 5 }}>작성자 닉네임 (자동 연동)</strong>
          <span style={{ fontWeight: 700 }}>{payload?.currentNickname || "로그인 정보 확인 중"}</span>
          <p style={{ color: "#667085", fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>모임페이지 로그인 계정의 닉네임으로 접수됩니다. 직접 수정하거나 다른 회원의 닉네임으로 제출할 수 없습니다.</p>
        </div>
        <p style={{ background: "#f0f3fa", borderRadius: 12, padding: 13, fontSize: 13, lineHeight: 1.7 }}>작성 시 로그인 계정의 닉네임이 자동으로 표시됩니다. 익명 작성은 지원하지 않으며, 의견과 답변은 작성자 본인과 방장·지정 운영진에게만 공개됩니다.</p>
        <label htmlFor="feedback-title" style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>제목</label>
        <input id="feedback-title" required minLength={2} maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="제목을 입력해주세요" style={{ ...fieldStyle, marginBottom: 17 }} />
        <label htmlFor="feedback-content" style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>내용</label>
        <textarea id="feedback-content" required minLength={5} maxLength={4000} rows={7} value={content} onChange={e => setContent(e.target.value)} placeholder="어떤 이야기든 자유롭게 남겨주세요." style={{ ...fieldStyle, resize: "vertical" }} />
        <p style={{ textAlign: "right", fontSize: 12, color: "#667085" }}>{content.length} / 4000자</p>
        <p style={{ background: "#f0f3fa", borderRadius: 12, padding: 13, fontSize: 13, lineHeight: 1.7 }}>🔒 내용과 답변은 작성자 본인과 방장·지정 운영진만 확인합니다. 다른 회원에게는 공개되지 않습니다.</p>
        <button type="submit" disabled={busy || !payload} style={{ ...buttonStyle, width: "100%", opacity: busy || !payload ? 0.5 : 1 }}>{busy ? "접수 중…" : "비공개 의견 제출"}</button>
      </form>}
      {activeTab === "mine" && <section aria-label="내 접수내역">
        {!payload?.mine.length && !loading && <div style={boxStyle}>아직 남긴 의견이 없습니다.</div>}
        {payload?.mine.map(item => <article key={item.id} style={boxStyle}>
          <div style={{ fontSize: 12, color: "#667085" }}>#{item.receipt_no ?? "접수"} · {categoryLabels[item.category]} · {new Date(item.created_at).toLocaleString("ko-KR")} · {statusLabels[item.status]}</div>
          <h2 style={{ fontSize: 18, overflowWrap: "anywhere" }}>{item.title}</h2>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7 }}>{item.content}</p>
          <div style={{ background: "#f4f6fa", padding: 13, borderRadius: 12, marginTop: 12 }}>
            <strong>운영진 비공개 답변</strong>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 0 }}>{replyOf(item)?.content || "아직 답변이 등록되지 않았습니다."}</p>
          </div>
          {!!item.jjinchin_feedback_reply_history?.length && <details style={{marginTop:12}}>
            <summary>답변 변경 이력 ({item.jjinchin_feedback_reply_history.length}건)</summary>
            {item.jjinchin_feedback_reply_history.map((h,i)=><div key={i} style={{padding:10,whiteSpace:"pre-wrap",overflowWrap:"anywhere",borderTop:"1px solid #e4e7f0"}}>
              <small>{new Date(h.replied_at).toLocaleString("ko-KR")} · {h.source==="kakao"?"운영진방":"웹"}</small><p>{h.content}</p>
            </div>)}
          </details>}
        </article>)}
      </section>}
      {activeTab === "inbox" && payload?.isReviewer && <section aria-label="운영진 접수함">
        <div style={{ ...boxStyle, fontSize: 13, color: "#667085" }}>모든 신규 의견은 작성자 닉네임과 함께 접수됩니다. 답변은 작성자 본인에게만 보입니다. 이전에 익명으로 접수된 내역이 있다면 기존 익명 설정은 유지합니다.</div>
        {payload.inbox.map(item => <article key={item.id} style={boxStyle}>
          <div style={{ fontSize: 12, color: "#667085" }}>#{item.receipt_no ?? "접수"} · {categoryLabels[item.category]} · {new Date(item.created_at).toLocaleString("ko-KR")} · {item.author || "회원"}</div>
          <h2 style={{ fontSize: 18, overflowWrap: "anywhere" }}>{item.title}</h2>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7 }}>{item.content}</p>
          <label htmlFor={"status-" + item.id} style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>처리 상태</label>
          <select id={"status-" + item.id} value={edits[item.id]?.status || item.status} onChange={e => setEdits(old => ({ ...old, [item.id]: { status: e.target.value as Status, reply: old[item.id]?.reply || "" } }))} style={{ ...fieldStyle, marginBottom: 12 }}>
            {(Object.entries(statusLabels) as [Status, string][]).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
          <label htmlFor={"reply-" + item.id} style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>비공개 답변</label>
          <textarea id={"reply-" + item.id} rows={4} maxLength={4000} value={edits[item.id]?.reply || ""} onChange={e => setEdits(old => ({ ...old, [item.id]: { status: old[item.id]?.status || item.status, reply: e.target.value } }))} style={{ ...fieldStyle, resize: "vertical" }} placeholder="작성자에게만 전달할 답변을 입력해주세요." />
          <button type="button" disabled={busy} onClick={() => void save(item)} style={{ ...buttonStyle, marginTop: 12 }}>저장</button>
        </article>)}
        {!payload.inbox.length && <div style={boxStyle}>접수된 의견이 없습니다.</div>}
        {payload.isOwner && <p><Link href="/feedback/operators" style={{color:"#4059ac",fontWeight:700}}>🤖 봇 운영진 카카오 ID 연결 관리</Link></p>}
        {payload.isOwner && <section style={boxStyle}>
          <h2 style={{ fontSize: 19, marginTop: 0 }}>소리함 담당 운영진</h2>
          <p style={{ color: "#667085", fontSize: 13 }}>방장은 항상 열람할 수 있으며, 지정된 관리자만 추가로 확인할 수 있습니다.</p>
          {!payload.admins.length && <p>지정 가능한 관리자 계정이 없습니다.</p>}
          {payload.admins.map(admin => <label key={admin.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid #edf0f5" }}>
            <input type="checkbox" checked={admin.selected} disabled={busy} onChange={e => void assign(admin.id, e.target.checked)} aria-label={admin.nickname + " 운영진 지정"} />
            <span>{admin.nickname}</span>
          </label>)}
        </section>}
      </section>}
    </div>
  </main>;
}
