"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Summary = { nickname: string; support_count: number; points_total: number; kakao_uid?: string };

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(new Date()).replace("/", "-");
}

export default function SupportHistoryPage() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adminRows, setAdminRows] = useState<Summary[] | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setAdminRows(null);
    supabase.rpc("get_monthly_support_summary", { p_month: month })
      .then(({ data, error }) => {
        if (cancelled) return;
        setRows((data || []) as Summary[]);
        setError(error?.message || "");
        setLoading(false);
      });

    // 일반 회원에게 공개 집계만 반환하고, 운영진에게만 삭제 식별자를 제공합니다.
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const response = await fetch("/api/support?month=" + encodeURIComponent(month), {
          headers: { Authorization: "Bearer " + session.access_token },
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const payload = await response.json();
        if (!cancelled && payload.ok && Array.isArray(payload.rows)) {
          setAdminRows(payload.rows as Summary[]);
        }
      } catch {
        // 관리자 확인에 실패해도 공개 조회는 유지합니다.
      }
    })();
    return () => { cancelled = true; };
  }, [month, reloadKey]);

  const displayRows = adminRows ?? rows;
  const totalPoints = useMemo(() => displayRows.reduce((sum, row) => sum + Number(row.points_total), 0), [displayRows]);
  const totalCount = useMemo(() => displayRows.reduce((sum, row) => sum + Number(row.support_count), 0), [displayRows]);

  async function removeMonthSupport(uid: string, nickname: string) {
    const question = month + " · " + nickname + "님의 후원리스트 기록을 삭제하시겠습니까?\\n\\n"
      + "해당 월 기록이 목록에서 제외되지만, 회원 계정과 이미 지급한 점수·메달은 차감되지 않습니다. "
      + "보상 회차 원본은 중복 지급 방지를 위해 보존됩니다.";
    if (!window.confirm(question)) return;
    setDeletingUid(uid);
    setActionMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("다시 로그인한 후 시도해주세요.");
      const response = await fetch("/api/support", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ month, uid, confirm: "DELETE_MONTH_SUPPORT" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "삭제 처리에 실패했습니다.");
      setActionMessage(nickname + "님의 " + month + " 후원리스트 기록 "
        + payload.removed + "건을 삭제했습니다. 점수·메달은 변경되지 않았습니다.");
      setReloadKey(value => value + 1);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "삭제 처리에 실패했습니다.");
    } finally {
      setDeletingUid(null);
    }
  }

  return <main style={{ minHeight: "100vh", background: "#f7f8fc", color: "#202638", padding: "24px 16px 60px" }}>
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Link href="/" style={{ color: "#4e5db0", fontWeight: 700, textDecoration: "none" }}>← 모임관리로 돌아가기</Link>
      <header style={{ margin: "24px 0" }}>
        <div style={{ fontSize: 13, color: "#667085", fontWeight: 700 }}>JJINCHIN · SUPPORT</div>
        <h1 style={{ fontSize: "clamp(26px,5vw,36px)", margin: "8px 0" }}>💝 월별 후원리스트</h1>
        <p style={{ color: "#667085", margin: 0 }}>관리자가 등록한 후원 횟수와 포인트 보상을 확인할 수 있습니다.</p>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <label htmlFor="support-month" style={{ fontWeight: 700 }}>조회 월</label>
        <input id="support-month" type="month" value={month} max={currentMonth()} onChange={e => setMonth(e.target.value)}
          style={{ padding: "11px 14px", borderRadius: 12, border: "1px solid #d5d9e4", background: "white", color: "#202638", fontSize: 16 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 20 }}>
        {([["후원 회원", rows.length + "명"], ["후원 횟수", totalCount + "회"], ["지급 포인트", totalPoints.toLocaleString("ko-KR") + "P"]] as const).map(([label, value]) =>
          <div key={label} style={{ background: "white", padding: 18, borderRadius: 16, border: "1px solid #e8eaf1" }}>
            <div style={{ color: "#667085", fontSize: 13 }}>{label}</div><div style={{ fontWeight: 800, fontSize: 22, marginTop: 6 }}>{value}</div>
          </div>)}
      </div>
      <section style={{ background: "white", borderRadius: 18, border: "1px solid #e8eaf1", overflow: "hidden" }}>
        <h2 style={{ fontSize: 19, padding: "20px 20px 14px", margin: 0 }}>후원 회원별 내역</h2>
        {loading ? <p role="status" style={{ padding: 20 }}>불러오는 중…</p>
          : error ? <p role="alert" style={{ padding: 20, color: "#b42318" }}>내역을 불러오지 못했습니다: {error}</p>
          : !rows.length ? <p style={{ padding: 20, color: "#667085" }}>선택한 달의 후원 내역이 없습니다.</p>
          : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 330 }}>
            <thead><tr style={{ background: "#f5f6fa", textAlign: "left" }}>
              <th scope="col" style={{ padding: 14 }}>닉네임</th><th scope="col" style={{ padding: 14 }}>후원 횟수</th><th scope="col" style={{ padding: 14 }}>획득 포인트</th>
            </tr></thead>
            <tbody>{rows.map((member, index) => <tr key={index} style={{ borderTop: "1px solid #eef0f5" }}>
              <td style={{ padding: 14, fontWeight: 700 }}>{member.nickname}</td>
              <td style={{ padding: 14 }}>{Number(member.support_count)}회</td>
              <td style={{ padding: 14 }}>{Number(member.points_total).toLocaleString("ko-KR")}P</td>
            </tr>)}</tbody></table></div>}
      </section>
      <section style={{ marginTop: 20, background: "white", borderRadius: 18, border: "1px solid #e8eaf1", padding: 20 }}>
        <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>후원 지급 기준</h2>
        <p style={{ margin: 0, lineHeight: 1.8 }}>매월 1회 5,000P · 2회 7,500P · 3회부터 매회 10,000P<br/>3회차부터는 매회 10,000P를 지급하며 횟수 제한은 없습니다. 매월 한국시간 1일에 횟수가 초기화되고 기존 후원 메달도 함께 지급됩니다.</p>
      </section>
    </div>
  </main>;
}
