"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { PetIntegrationSummary } from "../../lib/pet-integration-types";

const actionIcon: Record<string, string> = {
  FEED: "🍚",
  PLAY: "🎾",
  WALK: "🚶",
  SLEEP: "💤",
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatRemaining(seconds: number) {
  if (seconds <= 0) return "지금 가능";
  if (seconds < 60) return `${seconds}초 후`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}분 후`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분 후` : `${hours}시간 후`;
}

function StatusBar({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number;
}) {
  const safe = clamp(value);
  return (
    <div style={{ padding: 14, borderRadius: 16, background: "#f7f7fb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <strong>{icon} {label}</strong>
        <b>{safe}</b>
      </div>
      <div style={{ height: 8, borderRadius: 99, overflow: "hidden", background: "#e7e7ef" }}>
        <div style={{ width: `${safe}%`, height: "100%", borderRadius: 99, background: "#6254d9" }} />
      </div>
    </div>
  );
}

export default function PetPage() {
  const [summary, setSummary] = useState<PetIntegrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setError("모임페이지 로그인 후 PET을 이용할 수 있습니다.");
        setSummary(null);
        return;
      }

      const response = await fetch("/api/pet/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = (await response.json()) as PetIntegrationSummary;

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "PET 상태를 불러오지 못했습니다.");
      }

      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PET 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "찐친 PET | 강서구 찐친만들기";
    void load();
  }, [load]);

  const linkPet = async () => {
    if (linking) return;
    setLinking(true);
    setError("");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");

      const response = await fetch("/api/pet/link", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "PET 계정을 연결하지 못했습니다.");
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PET 계정을 연결하지 못했습니다.");
    } finally {
      setLinking(false);
    }
  };

  return (
    <main style={{ minHeight: "100dvh", background: "#f4f4f8", color: "#1b1b24", padding: "18px 14px 40px" }}>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: "#77778b", fontWeight: 700 }}>JJINCHIN SERVICE</p>
            <h1 style={{ margin: "4px 0 0", fontSize: 28 }}>🐾 찐친 PET</h1>
          </div>
          <Link href="/" style={{ textDecoration: "none", color: "#56516d", fontWeight: 700 }}>← 모임관리</Link>
        </header>

        <section style={{ background: "#fff", border: "1px solid #e7e7ef", borderRadius: 24, padding: 20, boxShadow: "0 14px 40px #15152a0a" }}>
          {loading && <p style={{ margin: 0, color: "#66667a" }}>PET 정보를 불러오는 중입니다…</p>}

          {!loading && error && (
            <div>
              <strong style={{ display: "block", marginBottom: 8 }}>PET을 불러오지 못했습니다.</strong>
              <p style={{ color: "#b42318", lineHeight: 1.6, margin: "0 0 14px" }}>{error}</p>
              <button onClick={() => void load()} style={{ border: 0, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer" }}>
                다시 확인
              </button>
            </div>
          )}

          {!loading && !error && summary && !summary.linked && (
            <div style={{ textAlign: "center", padding: "24px 8px" }}>
              <div style={{ fontSize: 54, marginBottom: 8 }}>🥚</div>
              <h2 style={{ margin: "0 0 8px" }}>기존 PET 계정을 연결해주세요</h2>
              <p style={{ color: "#66667a", lineHeight: 1.65, margin: "0 auto 18px", maxWidth: 480 }}>
                현재 모임페이지 닉네임과 기존 찐친 PET 닉네임이 일치하면 안전하게 계정을 연결합니다.
                연결 후에는 이 페이지에서 PET 상태를 바로 확인할 수 있습니다.
              </p>
              <button
                onClick={linkPet}
                disabled={linking}
                style={{ border: 0, borderRadius: 14, padding: "13px 18px", fontWeight: 800, background: "#342663", color: "#fff", cursor: linking ? "default" : "pointer" }}
              >
                {linking ? "연결 중…" : "기존 PET 연결"}
              </button>
            </div>
          )}

          {!loading && !error && summary?.linked && !summary.hasPet && (
            <div style={{ textAlign: "center", padding: "24px 8px" }}>
              <div style={{ fontSize: 54, marginBottom: 8 }}>🐾</div>
              <h2 style={{ margin: "0 0 8px" }}>계정 연결 완료</h2>
              <p style={{ color: "#66667a", lineHeight: 1.65, margin: 0 }}>
                연결된 PET 계정에는 아직 생성된 PET이 없습니다. PET 생성 기능은 완전 통합 단계에서 Meeting 내부로 옮깁니다.
              </p>
            </div>
          )}

          {!loading && !error && summary?.linked && summary.hasPet && summary.pet && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, alignItems: "center", paddingBottom: 18, borderBottom: "1px solid #ededf4" }}>
                <div>
                  <p style={{ margin: 0, color: "#77778b", fontSize: 13, fontWeight: 700 }}>{summary.pet.species?.name || "PET"}</p>
                  <h2 style={{ margin: "4px 0 6px", fontSize: 27 }}>{summary.pet.name}</h2>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", color: "#55556b", fontSize: 14 }}>
                    <span>LV.{summary.pet.level}</span>
                    <span>EXP {summary.pet.exp}</span>
                    <span>💗 {summary.pet.affection}</span>
                  </div>
                </div>
                <div style={{ minWidth: 92, textAlign: "center", borderRadius: 18, background: "#f7f4ff", padding: "13px 12px" }}>
                  <small style={{ display: "block", color: "#77778b", marginBottom: 4 }}>PET Coin</small>
                  <strong style={{ fontSize: 21 }}>{Number(summary.balance || 0).toLocaleString("ko-KR")}</strong>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <StatusBar icon="🍚" label="포만감" value={summary.pet.hunger} />
                <StatusBar icon="😊" label="행복" value={summary.pet.happiness} />
                <StatusBar icon="⚡" label="에너지" value={summary.pet.energy} />
              </div>

              <section style={{ marginTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <strong>🐾 PET 돌보기</strong>
                  <span style={{ fontSize: 12, color: "#77778b" }}>{summary.backendSource === "local" ? "Meeting 통합 조회" : "Bridge 조회 모드"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {(summary.actions || []).map((action) => (
                    <button
                      key={action.code}
                      disabled
                      title="돌보기 쓰기 기능은 다음 통합 단계에서 활성화됩니다."
                      style={{ textAlign: "left", border: "1px solid #e4e4ec", borderRadius: 14, padding: 13, background: action.available ? "#fbfbfd" : "#f4f4f7", color: "#343442" }}
                    >
                      <span style={{ fontSize: 22, marginRight: 8 }}>{actionIcon[action.code] || "🐾"}</span>
                      <strong>{action.name}</strong>
                      <small style={{ display: "block", marginTop: 6, color: "#77778b" }}>{formatRemaining(action.remainingSeconds)}</small>
                    </button>
                  ))}
                </div>
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#858598", lineHeight: 1.6 }}>
                  {summary.backendSource === "local" ? "Meeting 내부 PET 데이터로 전환되었습니다. 돌보기 쓰기 기능은 다음 단계에서 활성화합니다." : "아직 이관되지 않은 계정은 기존 PET 서버를 안전하게 조회합니다. 데이터 확인 후 Meeting 내부로 순차 전환합니다."}
                </p>
              </section>
            </>
          )}
        </section>

        <aside style={{ marginTop: 12, padding: "13px 16px", borderRadius: 16, background: "#ecebf4", color: "#5d5d70", fontSize: 12, lineHeight: 1.6 }}>
          PET 통합 STEP 32.5 · 이관 완료 계정은 Meeting 내부 DB를 우선 사용하고, 미이관 계정은 Bridge를 유지합니다. 기존 jjinchin-pet 데이터는 최종 검증 전까지 삭제하지 않습니다.
        </aside>
      </div>
    </main>
  );
}
