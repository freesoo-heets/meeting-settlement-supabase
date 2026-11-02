"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { POINT_ADMIN_MAX, REASON_MAX, TICKET_ADMIN_MAX } from "../lib/pointAdmin";

// 🏆 카톡 봇 점수 순위. 관리자는 ⚙️ 로 점수 · 티켓을 조정한다 (봇이 점수판에 반영)

export type PointRow = {
  kakao_uid: string;
  name: string;
  exp: number;
  tickets: number;
  trophies: string | null;
  place: number;
};

type Adjustment = { state: string; error: string | null; exp_after: number | null; tickets_after: number | null };
type CallResult = { ok: boolean; error?: string; id?: string; adjustment?: Adjustment };

async function callPointAdmin(payload: Record<string, unknown>): Promise<CallResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/point-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as CallResult;
}

const fmt = (n: number) => n.toLocaleString("ko-KR");
const POLL_MS = 2000;
const POLL_TRIES = 30; // 1분

function AmountRow({ label, unit, up, down, sign, value, disabled, onSign, onValue }: {
  label: string;
  unit: string;
  up: string;
  down: string;
  sign: 1 | -1;
  value: string;
  disabled: boolean;
  onSign: (sign: 1 | -1) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="pointAdminRow">
      <b>{label}</b>
      <div className="pointAdminSign">
        <button type="button" className={sign === 1 ? "on" : ""} disabled={disabled} onClick={() => onSign(1)}>{up}</button>
        <button type="button" className={sign === -1 ? "on down" : ""} disabled={disabled} onClick={() => onSign(-1)}>{down}</button>
      </div>
      <label>
        <input
          inputMode="numeric"
          aria-label={`${label} ${sign === 1 ? up : down} 수량`}
          value={value}
          disabled={disabled}
          placeholder="0"
          onChange={(event) => onValue(event.target.value.replace(/\D/g, "").slice(0, 7))}
        />
        <span>{unit}</span>
      </label>
    </div>
  );
}

function PointAdminBox({ row, onAdjusted, onClose }: {
  row: PointRow;
  onAdjusted: (uid: string, exp: number, tickets: number) => void;
  onClose: () => void;
}) {
  const [pointSign, setPointSign] = useState<1 | -1>(1);
  const [ticketSign, setTicketSign] = useState<1 | -1>(1);
  const [pointText, setPointText] = useState("");
  const [ticketText, setTicketText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err" | "wait"; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const points = pointSign * Number(pointText || 0);
  const tickets = ticketSign * Number(ticketText || 0);
  const tooMany = Math.abs(points) > POINT_ADMIN_MAX || Math.abs(tickets) > TICKET_ADMIN_MAX;
  const needReason = points !== 0 && !reason.trim();
  const ready = (points !== 0 || tickets !== 0) && !tooMany && !needReason;
  const preview = [
    points ? `💎 ${fmt(row.exp)} → ${fmt(Math.max(0, row.exp + points))}점` : "",
    tickets ? `🎫 ${row.tickets} → ${Math.max(0, row.tickets + tickets)}장` : "",
  ].filter(Boolean).join(" · ");

  async function apply() {
    setBusy(true);
    setNote({ kind: "wait", text: "⏳ 봇에게 요청했어요. 반영되면 바로 알려 드립니다." });
    const res = await callPointAdmin({ action: "adjust", uid: row.kakao_uid, points, tickets, reason: reason.trim() });
    if (!res.ok || !res.id) {
      setBusy(false);
      setNote({ kind: "err", text: `❌ ${res.error ?? "요청하지 못했습니다."}` });
      return;
    }
    for (let i = 0; i < POLL_TRIES && alive.current; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
      const status = await callPointAdmin({ action: "status", id: res.id });
      const adjustment = status.adjustment;
      if (!adjustment) continue;
      if (adjustment.state === "done") {
        setBusy(false);
        setPointText("");
        setTicketText("");
        setReason("");
        setNote({
          kind: "ok",
          text: `✅ 반영했어요.\n💎 ${adjustment.exp_after !== null ? fmt(adjustment.exp_after) : "-"}점 · 🎫 ${adjustment.tickets_after ?? "-"}장`,
        });
        if (adjustment.exp_after !== null && adjustment.tickets_after !== null) {
          onAdjusted(row.kakao_uid, adjustment.exp_after, adjustment.tickets_after);
        }
        return;
      }
      if (adjustment.state === "failed") {
        setBusy(false);
        setNote({ kind: "err", text: `❌ ${adjustment.error ?? "반영하지 못했습니다."}` });
        return;
      }
    }
    if (!alive.current) return;
    setBusy(false);
    setNote({ kind: "wait", text: "⚠️ 봇이 아직 처리하지 못했어요. 봇이 켜지면 자동으로 반영됩니다. 다시 넣지 말고 잠시 뒤 점수를 확인해 주세요." });
  }

  return (
    <div className="ticketBuyBack" onClick={onClose}>
      <div className="ticketBuyBox pointAdminBox" role="dialog" aria-modal="true" aria-label={`${row.name} 점수 관리`} onClick={(event) => event.stopPropagation()}>
        <strong>⚙️ {row.name}</strong>
        <p className="ticketBuyHave">💎 {fmt(row.exp)}점 · 🎫 {row.tickets}장</p>
        <AmountRow label="점수" unit="점" up="올리기" down="내리기" sign={pointSign} value={pointText} disabled={busy} onSign={setPointSign} onValue={setPointText} />
        <input
          className="pointAdminReason"
          aria-label="사유"
          value={reason}
          maxLength={REASON_MAX}
          disabled={busy}
          placeholder="사유 (점수를 바꿀 때 필수)"
          onChange={(event) => setReason(event.target.value)}
        />
        <AmountRow label="티켓" unit="장" up="넣기" down="빼기" sign={ticketSign} value={ticketText} disabled={busy} onSign={setTicketSign} onValue={setTicketText} />
        {preview && <p className="ticketBuyCost">{preview}</p>}
        {tooMany && (
          <p className="ticketBuyCost short">
            한 번에 {fmt(POINT_ADMIN_MAX)}점 · {TICKET_ADMIN_MAX}장까지 바꿀 수 있어요
          </p>
        )}
        {note && <p className={`ticketBuyNote ${note.kind}`}>{note.text}</p>}
        <div className="ticketBuyButtons">
          <button className="ticketBuyGo" disabled={busy || !ready} onClick={() => void apply()}>
            {busy ? "처리 중…" : "적용"}
          </button>
          <button className="smallButton ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  rows: PointRow[];
  hidden: number;
  season: number | null;
  syncedAt: string;
  myUid: string | null;
  isAdmin: boolean;
  inGame?: boolean;
  onAdjusted: (uid: string, exp: number, tickets: number) => void;
  onClose: () => void;
};

export default function PointRanking({ rows, hidden, season, syncedAt, myUid, isAdmin, inGame, onAdjusted, onClose }: Props) {
  const [managing, setManaging] = useState<string | null>(null);
  const managed = rows.find((row) => row.kakao_uid === managing);

  return (
    <div
      className={`meetingModalBackdrop ${inGame ? "gameBackdrop" : ""}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal pointRankingModal" role="dialog" aria-modal="true">
        <div className="meetingModalHeader">
          <div>
            <span>카톡 봇 점수판{season ? ` · 시즌 ${season}` : ""}</span>
            <h2>🏆 점수 순위</h2>
          </div>
          <button className="modalCloseButton" onClick={onClose}>×</button>
        </div>

        {rows.length >= 3 && (
          <div className="pointPodium">
            {[1, 0, 2].map((index) => {
              const row = rows[index];
              return (
                <div key={row.kakao_uid} className={`pointPodiumItem place${row.place}`}>
                  <span className="pointPodiumMedal">{["🥇", "🥈", "🥉"][index]}</span>
                  <strong>{row.name}</strong>
                  <em>{row.exp.toLocaleString("ko-KR")}점</em>
                </div>
              );
            })}
          </div>
        )}

        <ol className={`pointRankingList ${isAdmin ? "manage" : ""}`}>
          {rows.map((row) => {
            const isMe = myUid === row.kakao_uid;
            return (
              <li key={row.kakao_uid} className={isMe ? "me" : ""}>
                <span className={`pointRankNo ${row.place <= 3 ? "top" : ""}`}>{row.place}</span>
                <span className="pointRankName">
                  <strong>{row.name}</strong>
                  {isMe && <em className="pointRankMe">나</em>}
                  {row.trophies && <em className="pointRankTrophies">{row.trophies}</em>}
                </span>
                {isAdmin && (
                  <button className="pointRankManage" aria-label={`${row.name} 점수 관리`} onClick={() => setManaging(row.kakao_uid)}>⚙️</button>
                )}
                <span className="pointRankScore">
                  <strong>{row.exp.toLocaleString("ko-KR")}</strong>
                  <em>점{row.tickets ? ` · 🎫${row.tickets}` : ""}</em>
                </span>
              </li>
            );
          })}
        </ol>

        <p className="pointRankingFoot">
          {hidden > 0 && `💤 7일 이상 미활동 ${hidden}명 숨김 · `}
          {syncedAt &&
            `${new Date(syncedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 갱신 · 1분마다 반영`}
        </p>
      </section>
      {managed && <PointAdminBox key={managed.kakao_uid} row={managed} onAdjusted={onAdjusted} onClose={() => setManaging(null)} />}
    </div>
  );
}
