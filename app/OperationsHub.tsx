"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { PetIntegrationSummary } from "../lib/pet-integration-types";
import { readTarotPortalUsage } from "../lib/tarot-portal";
import OperationsChecks from "./OperationsChecks";
import styles from "./operationsHub.module.css";

type Metric = { title: string; value: string; detail: string; open: () => void };
type Props = {
  userId: string;
  role: "owner" | "admin" | "user";
  month: string;
  onMonthChange: (month: string) => void;
  dataReady: boolean;
  dataLoading: boolean;
  metrics: Metric[];
  botSyncedAt: string | null;
  onOpenBot: () => void;
  onOpenHistory: () => void;
  onOpenHelp: () => void;
};

const koreaDate = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul",
});

function displayDate(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? koreaDate.format(new Date(value)) : "기록 없음";
}

export default function OperationsHub({
  userId, role, month, onMonthChange, dataReady, dataLoading, metrics,
  botSyncedAt, onOpenBot, onOpenHistory, onOpenHelp,
}: Props) {
  const [pet, setPet] = useState<PetIntegrationSummary | "failed" | null>(null);
  const [tarot, setTarot] = useState<string | null>(null);
  const [usage, setUsage] = useState({ visits: 0, lastVisit: null as string | null });
  const [refresh, setRefresh] = useState(0);
  const isAdmin = role === "admin" || role === "owner";

  useEffect(() => {
    const controller = new AbortController();
    const options = { cache: "no-store", signal: controller.signal } as const;
    setPet(null);
    setTarot(null);
    setUsage(readTarotPortalUsage(userId));
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session || data.session.user.id !== userId) throw new Error("session");
        const response = await fetch("/api/pet/me", {
          ...options, headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        const result: PetIntegrationSummary = await response.json();
        if (!response.ok || !result.ok) throw new Error("pet");
        if (!controller.signal.aborted) setPet(result);
      } catch {
        if (!controller.signal.aborted) setPet("failed");
      }
    })();
    void fetch("/api/tarot/status", options)
      .then(async (response) => response.ok ? (await response.json()).status : "unavailable")
      .then((status) => { if (!controller.signal.aborted) setTarot(status); })
      .catch(() => { if (!controller.signal.aborted) setTarot("unavailable"); });
    return () => controller.abort();
  }, [userId, refresh]);

  const petStatus = pet === null ? "확인 중" : pet === "failed" ? "조회 실패"
    : !pet.linked ? "계정 연결 필요" : pet.backendSource === "local" ? "통합 DB"
      : pet.backendSource === "bridge" ? "기존 펫 서비스 연계" : "계정 연결됨";
  const tarotStatus = tarot === null ? "확인 중" : tarot === "ready" ? "리딩 서버 응답 정상"
    : tarot === "degraded" ? "리딩 설정 확인 필요" : "연계 상태 확인 실패";

  return <section className={styles.hub} aria-labelledby="operations-title">
    <header className={styles.hero}>
      <div><p>{month} 운영 현황 · {role === "owner" ? "제작자" : isAdmin ? "관리자" : "회원"}</p>
        <h2 id="operations-title">찐친 운영 허브</h2>
      </div>
      <div className={styles.actions}>
        <button onClick={onOpenHistory}>최근 변경이력</button>
        <button onClick={onOpenHelp}>사용방법</button>
      </div>
    </header>

    <section className={styles.section}>
      <div className={styles.heading}>
        <h3>모임 운영</h3>
        <label>기준 월 <input type="month" value={month}
          onChange={(event) => { if (event.target.value) onMonthChange(event.target.value); }} /></label>
      </div>
      {!dataReady && <p role="status">{dataLoading ? "모임 데이터를 불러오는 중입니다." : "모임 데이터 조회에 실패했습니다."}</p>}
      <div className={styles.grid}>
        {metrics.map(({ title, value, detail, open }) => <button className={styles.metric} key={title} onClick={open}>
          <span>{title}</span><strong>{dataReady ? value : "—"}</strong><small>{detail} ›</small>
        </button>)}
      </div>
    </section>

    <section className={styles.section} aria-labelledby="operations-services">
      <div className={styles.heading}>
        <h3 id="operations-services">서비스와 데이터 연계</h3>
        <button onClick={() => setRefresh((value) => value + 1)}>상태 새로고침</button>
      </div>
      <div className={styles.services}>
        <article className={styles.card}>
          <h4>찐친 PET</h4><strong aria-live="polite">{petStatus}</strong>
          <p>{pet && pet !== "failed" && pet.pet
            ? `${pet.pet.name} · 레벨 ${pet.pet.level} · 에너지 ${pet.pet.energy}`
            : "내 펫 상태와 돌보기"}</p>
          <Link href="/pet">펫 열기 ›</Link>
        </article>
        <article className={styles.card}>
          <h4>타로뱅크</h4><strong aria-live="polite">{tarotStatus}</strong>
          <p>이 브라우저에서 선택 {usage.visits}회 · 최근 {displayDate(usage.lastVisit)}</p>
          <small>리딩 기록과 로그인은 타로뱅크에서 관리합니다.</small>
          <Link href="/tarot">타로뱅크 열기 ›</Link>
        </article>
        {isAdmin && <article className={styles.card}>
          <h4>카카오톡 봇</h4><strong>점수판 마지막 동기화</strong>
          <p>{displayDate(botSyncedAt)}</p>
          <button onClick={onOpenBot}>봇관리 열기 ›</button>
        </article>}
      </div>
    </section>

    {isAdmin && <OperationsChecks />}
  </section>;
}
