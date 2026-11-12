"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { recordTarotPortalUsage, tarotOrigin } from "../../lib/tarot-portal";
import styles from "../operationsHub.module.css";

const readings = [
  ["three-card", "3카드 리딩"],
  ["six-month", "6개월 운세"],
  ["celtic-cross", "켈틱 크로스"],
] as const;

export default function TarotPortal() {
  const [reading, setReading] = useState("");

  async function openReading(path: string) {
    setReading(path);
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id) recordTarotPortalUsage(data.session.user.id);
  }

  return <>
    <div className={styles.actions}>
      {readings.map(([id, label]) => <button key={id} type="button" aria-pressed={reading === `/reading/${id}`}
        onClick={() => void openReading(`/reading/${id}`)}>{label}</button>)}
      <button type="button" aria-pressed={reading === "/history"} onClick={() => void openReading("/history")}>내 리딩 기록</button>
    </div>
    {reading && <div className={styles.tarotFrame}>
      <p>프레임에서 로그인이나 리딩이 막히면 타로뱅크에서 이어서 이용할 수 있습니다.</p>
      <a href={tarotOrigin + reading} target="_blank" rel="noopener noreferrer">타로뱅크에서 열기 ↗</a>
      <iframe src={tarotOrigin + reading} title="타로뱅크 리딩 및 기록" referrerPolicy="strict-origin-when-cross-origin" />
    </div>}
  </>;
}
