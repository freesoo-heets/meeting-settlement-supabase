"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

type Row = { profileId: string; nickname: string; role: string; kakaoUid: string };
export default function FeedbackBotOperators() {
  const [rows,setRows] = useState<Row[]>([]);
  const [original,setOriginal] = useState<Record<string,string>>({});
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const api = useCallback(async (method: "GET"|"PUT", body?: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw Error("모임페이지에 로그인해주세요.");
    const response = await fetch("/api/feedback/operators", {
      method, cache: "no-store", headers: {
        Authorization: "Bearer " + session.access_token,
        ...(body ? { "Content-Type": "application/json" } : {})
      }, ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.error || "요청 실패");
    return data;
  },[]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("GET");
      setRows(data.rows);
      setOriginal(Object.fromEntries((data.rows as Row[]).map(r => [r.profileId,r.kakaoUid])));
    } catch(e) { setMessage(e instanceof Error ? e.message : "조회에 실패했습니다."); }
    finally { setLoading(false); }
  },[api]);
  useEffect(() => { void load(); },[load]);
  async function save(row:Row) {
    setBusy(true);setMessage("");
    try { await api("PUT",{profileId:row.profileId,kakaoUid:row.kakaoUid});setMessage(row.nickname+"님의 연결을 저장했습니다.");await load(); }
    catch(e){setMessage(e instanceof Error ? e.message:"저장에 실패했습니다.");}
    finally{setBusy(false);}
  }
  const connected = rows.filter(row => row.kakaoUid.trim()).length;
  return <main style={{ minHeight: "100vh", background: "#f7f8fc", color: "#202638", padding: "24px 14px 72px" }}>
    <div style={{ maxWidth: 840, margin: "0 auto" }}>
      <Link href="/feedback" style={{ display: "inline-block", color: "#4059ac", fontWeight: 700, textDecoration: "none", marginBottom: 20 }}>← 찐친 소리함으로</Link>
      <header style={{ marginBottom: 20 }}>
        <p style={{ color: "#6176af", letterSpacing: "0.12em", fontSize: 12, fontWeight: 800, margin: 0 }}>PRIVATE FEEDBACK · BOT ACCESS</p>
        <h1 style={{ fontSize: "clamp(24px, 5vw, 31px)", margin: "8px 0 10px", letterSpacing: "-0.035em" }}>🤖 운영진 카카오 ID 연결</h1>
        <p style={{ lineHeight: 1.7, color: "#667085", fontSize: 14, margin: 0 }}>
          실제 카카오톡 사용자 고유 ID를 회원 계정과 연결합니다. 닉네임으로 권한을 확인하지 않으며,
          봇 관리자 명령어 권한과 웹 접수함 열람 권한은 별도로 관리됩니다.
        </p>
      </header>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14, padding: "14px 16px", background: "#edf2ff", borderRadius: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#344d98" }}>카카오 ID 연결 현황</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "#344d98" }}>{loading ? "확인 중" : `${connected} / ${rows.length}명 연결`}</span>
      </div>
      {message && <p role="status" style={{ padding: 13, background: "#fff", border: "1px solid #e5e9f2", borderRadius: 12, overflowWrap: "anywhere" }}>{message}</p>}
      {loading && <p role="status" style={{ color: "#667085" }}>연결 정보를 불러오는 중…</p>}
      {!loading && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 12 }}>
        {rows.map(row => {
          const changed = row.kakaoUid !== original[row.profileId];
          const hasId = Boolean(row.kakaoUid.trim());
          return <section key={row.profileId} style={{ minWidth: 0, background: "#fff", border: "1px solid #e2e7f0", padding: 18, borderRadius: 17 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 17, minWidth: 0 }}>
              <span aria-hidden="true" style={{ width: 41, height: 41, flexShrink: 0, borderRadius: 13, background: "#e9efff", color: "#4059ac", display: "grid", placeItems: "center", fontWeight: 800 }}>{row.nickname.slice(0, 1)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 16, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{row.nickname}</strong>
                <span style={{ display: "block", fontSize: 12, marginTop: 3, color: "#768197" }}>{row.role === "owner" ? "방장" : "관리자"}</span>
              </span>
              <span style={{ borderRadius: 999, padding: "5px 9px", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, background: hasId ? "#ecf7f1" : "#f3f4f7", color: hasId ? "#207650" : "#7b8393" }}>{hasId ? "연결됨" : "미연결"}</span>
            </div>
            <label htmlFor={"uid-" + row.profileId} style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>카카오 사용자 고유 ID</label>
            <input id={"uid-" + row.profileId} value={row.kakaoUid} maxLength={256}
              onChange={e => setRows(old => old.map(x => x.profileId === row.profileId ? { ...x, kakaoUid: e.target.value } : x))}
              placeholder="봇에서 확인한 사용자 ID" inputMode="numeric" autoComplete="off" spellCheck={false}
              style={{ display: "block", width: "100%", minWidth: 0, boxSizing: "border-box", padding: "12px 13px", fontSize: 15, fontVariantNumeric: "tabular-nums", borderRadius: 11, color: "#202638", background: "#fff", border: "1px solid #ccd4e2" }}/>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 12 }}>
              <button type="button" disabled={busy || !changed} onClick={() => void save(row)} style={{ padding: "10px 16px", minHeight: 42, borderRadius: 10, border: 0, fontWeight: 700, color: "#fff", background: "#4059ac", cursor: busy || !changed ? "not-allowed" : "pointer", opacity: busy || !changed ? 0.48 : 1 }}>
                {busy ? "처리 중…" : "변경사항 저장"}
              </button>
              {row.kakaoUid && <button type="button" disabled={busy} onClick={() => { if (window.confirm(row.nickname + "님의 카카오 ID 연결을 해제할까요?")) { void (async () => { setBusy(true); setMessage(""); try { await api("PUT", { profileId: row.profileId, kakaoUid: "" }); setMessage(row.nickname + "님의 연결을 해제했습니다."); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "연결 해제에 실패했습니다."); } finally { setBusy(false); } })(); } }} style={{ padding: "10px 14px", minHeight: 42, borderRadius: 10, fontWeight: 700, background: "#fff", color: "#667085", border: "1px solid #d9dfeb", cursor: "pointer" }}>연결 해제</button>}
            </div>
          </section>;
        })}
      </div>}
    </div>
  </main>;
}
