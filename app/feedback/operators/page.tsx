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
  return <main style={{minHeight:"100vh",background:"#f7f8fc",color:"#202638",padding:"24px 16px"}}>
    <div style={{maxWidth:760,margin:"auto"}}>
      <Link href="/feedback" style={{color:"#4059ac",textDecoration:"none"}}>← 찐친 소리함으로</Link>
      <h1 style={{fontSize:"clamp(24px,5vw,32px)"}}>🤖 소리함 봇 담당자 연결</h1>
      <p style={{lineHeight:1.7,color:"#667085"}}>방장 전용 설정입니다. 카카오톡의 고유 사용자 ID를 모임페이지 회원 계정에 연결합니다. 닉네임 문자열이 아닌 실제 카카오 ID를 사용하세요. 이 설정만으로 운영진 권한이 부여되지는 않으며, 소리함 담당자로 지정된 운영진만 답변할 수 있습니다.</p>
      {message&&<p role="status" style={{padding:12,background:"#fff",borderRadius:10}}>{message}</p>}
      {loading&&<p>조회 중…</p>}
      {!loading&&rows.map(row=><section key={row.profileId} style={{background:"#fff",border:"1px solid #e0e4ed",padding:16,borderRadius:14,marginBottom:12}}>
        <strong>{row.nickname} <small style={{color:"#667085"}}>({row.role==="owner"?"방장":"관리자"})</small></strong>
        <label htmlFor={"uid-"+row.profileId} style={{display:"block",margin:"12px 0 5px",fontSize:13}}>카카오 사용자 고유 ID</label>
        <input id={"uid-"+row.profileId} value={row.kakaoUid} maxLength={256} onChange={e=>setRows(old=>old.map(x=>x.profileId===row.profileId?{...x,kakaoUid:e.target.value}:x))}
          placeholder="봇에서 확인된 카카오 사용자 ID" autoComplete="off"
          style={{width:"100%",boxSizing:"border-box",padding:12,fontSize:16,borderRadius:10,border:"1px solid #d1d5e0"}}/>
        <button type="button" disabled={busy||row.kakaoUid===original[row.profileId]} onClick={()=>void save(row)}
          style={{marginTop:10,padding:"10px 18px",borderRadius:10,color:"#fff",background:"#4059ac",border:0,opacity:busy||row.kakaoUid===original[row.profileId]?0.5:1}}>저장 / 연결 해제</button>
      </section>)}
    </div>
  </main>;
}
