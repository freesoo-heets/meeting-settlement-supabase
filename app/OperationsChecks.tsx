"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import styles from "./operationsHub.module.css";

const phases = [
  { title: "기준 브랜치와 기존 기능", checks: [
    ["main", "최신 main·진행 중인 PR·변경 전후 빌드 확인"],
    ["meetings", "모임 생성·출석·정산 입금자·생일·봇관리 확인"],
    ["mobile", "모바일 메뉴와 펫·타로 진입 확인"],
    ["roles", "회원·관리자·제작자 권한과 직접 요청 차단 확인"],
  ] },
  { title: "펫 이관과 보상", checks: [
    ["pet-local", "이관 계정의 상태·돌보기 및 저장 확인"],
    ["pet-bridge", "미이관 계정의 기존 서비스 연계 확인"],
    ["pet-rewards", "출석 보상 재시도 및 중복 지급 방지 확인"],
  ] },
  { title: "타로 연계와 운영 반영", checks: [
    ["tarot-reading", "세 가지 리딩과 외부 열기 확인"],
    ["tarot-history", "기존 타로 로그인과 리딩 기록 확인"],
    ["release", "프리뷰 검증, 운영 반영 및 복구 경로 확인"],
  ] },
] as const;

const labels = { pending: "대기", running: "진행 중", blocked: "확인 필요", passed: "통과" };
type Status = keyof typeof labels;
type Check = { check_id: string; status: Status; note: string; updated_at: string };
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul",
});

export default function OperationsChecks() {
  const [checks, setChecks] = useState<Record<string, Check> | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.from("operations_hub_checks")
        .select("check_id,status,note,updated_at");
      if (!active) return;
      if (error) {
        setError("진행 기록을 불러오지 못했습니다. 운영 DB의 마이그레이션과 권한을 확인해 주세요.");
        return;
      }
      setChecks(Object.fromEntries((data as Check[]).map((row) => [row.check_id, row])));
    })();
    return () => { active = false; };
  }, [reload]);

  return <section className={styles.section} aria-labelledby="operations-checks">
    <h3 id="operations-checks">통합 검증 체크리스트</h3>
    {error && <p role="alert">{error} <button onClick={() => { setError(""); setReload((n) => n + 1); }}>다시 시도</button></p>}
    {!checks && !error && <p role="status">진행 기록을 불러오는 중입니다.</p>}
    {phases.map((phase, index) => <details className={styles.card} key={phase.title}>
      <summary><strong>{index + 1}단계 · {phase.title}</strong>
        {checks && <span> · {phase.checks.filter(([id]) => checks[id]?.status === "passed").length}/{phase.checks.length} 통과</span>}
      </summary>
      {checks && phase.checks.map(([id, title]) => <CheckEditor key={id} id={id} title={title}
        row={checks[id]} onSaved={(row) => setChecks((previous) => ({ ...previous, [id]: row }))}
        onReload={() => setReload((n) => n + 1)} />)}
    </details>)}
  </section>;
}

function CheckEditor({ id, title, row, onSaved, onReload }: {
  id: string; title: string; row?: Check; onSaved: (row: Check) => void; onReload: () => void;
}) {
  const [status, setStatus] = useState<Status>(row?.status ?? "pending");
  const [note, setNote] = useState(row?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(row?.updated_at);
  const hasNewerRecord = revision !== row?.updated_at;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const table = supabase.from("operations_hub_checks");
      const values = { status, note: note.trim() };
      const query = revision
        ? table.update(values).eq("check_id", id).eq("updated_at", revision)
        : table.insert({ check_id: id, ...values });
      const { data, error } = await query.select("check_id,status,note,updated_at").maybeSingle();
      if (error && error.code !== "23505") throw error;
      if (!data) {
        onReload();
        setMessage("다른 운영자가 이 항목을 저장했습니다. 최신 기록을 확인해 주세요.");
        return;
      }
      onSaved(data as Check);
      setRevision(data.updated_at);
      setNote(values.note);
      setMessage("저장했습니다.");
    } catch {
      setMessage("저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return <form className={styles.check} onSubmit={(event) => void save(event)}>
    <strong>{title}</strong>
    <div className={styles.checkInputs}>
      <select aria-label={`${title} 상태`} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as Status)}>
        {Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <input aria-label={`${title} 메모`} placeholder="검증 결과 또는 이슈 링크" value={note}
        disabled={busy} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      <button type="submit" disabled={busy || hasNewerRecord || (status === (row?.status ?? "pending") && note.trim() === (row?.note ?? ""))}>저장</button>
      {hasNewerRecord && <button type="button" onClick={() => {
        setStatus(row?.status ?? "pending");
        setNote(row?.note ?? "");
        setRevision(row?.updated_at);
        setMessage("");
      }}>최신 기록 불러오기</button>}
    </div>
    <small aria-live="polite">{message || (row ? `최근 저장 ${dateFormat.format(new Date(row.updated_at))}` : "")}</small>
  </form>;
}
