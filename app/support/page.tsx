"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Summary = { nickname: string; support_count: number; points_total: number };

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(new Date()).replace("/", "-");
}

export default function SupportHistoryPage() {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    supabase.rpc("get_monthly_support_summary", { p_month: month })
      .then(({ data, error }) => {
        if (cancelled) return;
        setRows((data || []) as Summary[]);
        setError(error?.message || "");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [month]);
  const totalPoints = useMemo(() => rows.reduce((sum, row) => sum + Number(row.points_total), 0), [rows]);
  const totalCount = useMemo(() => rows.reduce((sum, row) => sum + Number(row.support_count), 0), [rows]);

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
        <p style={{ margin: 0, lineHeight: 1.8 }}>매월 1회 5,000P · 2회 7,500P · 3회 10,000P<br/>매월 한국시간 1일에 횟수가 초기화되며, 월 최대 3회까지 지급합니다. 기존 후원 메달도 함께 지급됩니다.</p>
      </section>
    </div>
  </main>;
}
