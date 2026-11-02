"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { MEDAL_MAX, POINT_ADMIN_MAX, REASON_MAX, TICKET_ADMIN_MAX } from "../lib/pointAdmin";

// 🏆 카톡 봇 점수 순위. 누구나 📜 로 점수 내역을 보고, 관리자는 ⚙️ 로 점수 · 티켓 · 메달을 조정한다 (봇이 점수판에 반영)

export type PointRow = {
  kakao_uid: string;
  name: string;
  exp: number;
  tickets: number;
  trophies: string | null;
  place: number;
};

export type PointPatch = { exp?: number; tickets?: number; trophies?: string };
type PointLog = { t: string; amt: number; after: number; why: string; by: string };
type Adjustment = {
  state: string;
  error: string | null;
  exp_after: number | null;
  tickets_after: number | null;
  medals_after?: string | null;
  trophies_after?: string | null;
};
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
const QUICK_MEDALS = ["🥇", "🥈", "🥉", "👑", "💸"];

// 🥇🥈 → 낱개 메달 (⚔️ 처럼 여러 글자로 된 이모지도 하나로)
function splitMedals(text: string) {
  return [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text)].map((item) => item.segment);
}

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

const HISTORY_MAX = 100;
const HISTORY_PAGE = 20;

function PointHistoryBox({ row, onClose }: { row: PointRow; onClose: () => void }) {
  const [logs, setLogs] = useState<PointLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let alive = true;
    void supabase
      .from("bot_point_details")
      .select("logs")
      .eq("uid", row.kakao_uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) setFailed(true);
        else setLogs((data.logs as PointLog[]).slice(-HISTORY_MAX).reverse()); // 최신이 위로
      });
    return () => {
      alive = false;
    };
  }, [row.kakao_uid]);

  const pages = Math.max(1, Math.ceil((logs?.length ?? 0) / HISTORY_PAGE));
  const shown = logs?.slice(page * HISTORY_PAGE, (page + 1) * HISTORY_PAGE) ?? [];

  return (
    <div className="ticketBuyBack" onClick={onClose}>
      <div className="ticketBuyBox pointHistoryBox" role="dialog" aria-modal="true" aria-label={`${row.name} 점수 내역`} onClick={(event) => event.stopPropagation()}>
        <strong>📜 {row.name}님의 점수 내역</strong>
        <p className="ticketBuyHave">💎 현재 점수: {fmt(row.exp)}점{logs ? ` · 최근 ${logs.length}건` : ""}</p>
        {failed && <p className="ticketBuyNote">아직 내역이 올라오지 않았어요. 잠시 뒤 다시 봐 주세요.</p>}
        {!logs && !failed && <p className="muted">불러오는 중…</p>}
        {logs?.length === 0 && <p className="ticketBuyNote">점수 내역이 없습니다.</p>}
        {shown.length > 0 && (
          <ol className="pointHistoryList" key={page}>
            {shown.map((log, index) => (
              <li key={`${log.t}-${index}`}>
                <div>
                  <time>{log.t}</time>
                  <b className={log.amt < 0 ? "minus" : "plus"}>{log.amt < 0 ? "" : "+"}{fmt(log.amt)}</b>
                  <em>{fmt(log.after)}점</em>
                </div>
                {(log.why || log.by) && (
                  <p>{log.why}{log.by ? ` [${log.by}]` : ""}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {pages > 1 && (
          <div className="pointHistoryPager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>‹ 최신</button>
            <span>{page + 1} / {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>이전 ›</button>
          </div>
        )}
        <p className="pointRankingFoot">※ 채팅으로 쌓이는 점수는 제외됩니다.</p>
        <button className="smallButton ghost" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

function PointAdminBox({ row, onAdjusted, onClose }: {
  row: PointRow;
  onAdjusted: (uid: string, patch: PointPatch) => void;
  onClose: () => void;
}) {
  const [pointSign, setPointSign] = useState<1 | -1>(1);
  const [ticketSign, setTicketSign] = useState<1 | -1>(1);
  const [pointText, setPointText] = useState("");
  const [ticketText, setTicketText] = useState("");
  const [reason, setReason] = useState("");
  const [medals, setMedals] = useState<string | null>(null);
  const [medalMissing, setMedalMissing] = useState(false);
  const [medalText, setMedalText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err" | "wait"; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  useEffect(() => {
    void supabase
      .from("bot_point_details")
      .select("medals")
      .eq("uid", row.kakao_uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive.current) return;
        if (error || !data) setMedalMissing(true);
        else setMedals(data.medals as string);
      });
  }, [row.kakao_uid]);

  const points = pointSign * Number(pointText || 0);
  const tickets = ticketSign * Number(ticketText || 0);
  const tooMany = Math.abs(points) > POINT_ADMIN_MAX || Math.abs(tickets) > TICKET_ADMIN_MAX;
  const needReason = points !== 0 && !reason.trim();
  const ready = (points !== 0 || tickets !== 0) && !tooMany && !needReason;
  const preview = [
    points ? `💎 ${fmt(row.exp)} → ${fmt(Math.max(0, row.exp + points))}점` : "",
    tickets ? `🎫 ${row.tickets} → ${Math.max(0, row.tickets + tickets)}장` : "",
  ].filter(Boolean).join(" · ");

  async function send(payload: Record<string, unknown>, finish: (adjustment: Adjustment) => void) {
    setBusy(true);
    setNote({ kind: "wait", text: "⏳ 봇에게 요청했어요. 반영되면 바로 알려 드립니다." });
    const res = await callPointAdmin({ ...payload, uid: row.kakao_uid });
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
        finish(adjustment);
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

  function apply() {
    void send({ action: "adjust", points, tickets, reason: reason.trim() }, (adjustment) => {
      setPointText("");
      setTicketText("");
      setReason("");
      setNote({
        kind: "ok",
        text: `✅ 반영했어요.\n💎 ${adjustment.exp_after !== null ? fmt(adjustment.exp_after) : "-"}점 · 🎫 ${adjustment.tickets_after ?? "-"}장`,
      });
      if (adjustment.exp_after !== null && adjustment.tickets_after !== null) {
        onAdjusted(row.kakao_uid, { exp: adjustment.exp_after, tickets: adjustment.tickets_after });
      }
    });
  }

  function changeMedal(change: { add: string } | { remove: string }) {
    void send({ action: "medal", ...change }, (adjustment) => {
      setMedalText("");
      setMedals(adjustment.medals_after ?? "");
      setMedalMissing(false);
      setNote({ kind: "ok", text: "add" in change ? `✅ ${change.add} 메달을 넣었어요.` : `✅ ${change.remove} 메달을 지웠어요.` });
      onAdjusted(row.kakao_uid, { trophies: adjustment.trophies_after ?? "" });
    });
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
        <button className="ticketBuyGo" disabled={busy || !ready} onClick={apply}>
          {busy ? "처리 중…" : "적용"}
        </button>
        <div className="pointAdminMedals">
          <b>메달 <em>누르면 바로 반영</em></b>
          <div className="pointMedalChips">
            {medals && splitMedals(medals).map((medal, index) => (
              <button
                key={`${medal}-${index}`}
                disabled={busy}
                aria-label={`${medal} 메달 삭제`}
                onClick={() => changeMedal({ remove: medal })}
              >
                {medal}<i aria-hidden="true">×</i>
              </button>
            ))}
            {medals === "" && <span>메달 없음</span>}
            {medals === null && <span>{medalMissing ? "메달 목록이 아직 올라오지 않았어요" : "불러오는 중…"}</span>}
          </div>
          <div className="pointMedalAdd">
            {QUICK_MEDALS.map((medal) => (
              <button key={medal} disabled={busy} aria-label={`${medal} 메달 추가`} onClick={() => changeMedal({ add: medal })}>{medal}</button>
            ))}
            <input
              aria-label="메달 직접 입력"
              value={medalText}
              maxLength={MEDAL_MAX}
              disabled={busy}
              placeholder="직접"
              onChange={(event) => setMedalText(event.target.value.replace(/\s/g, ""))}
            />
            <button className="add" disabled={busy || !medalText} onClick={() => changeMedal({ add: medalText })}>추가</button>
          </div>
        </div>
        {note && <p className={`ticketBuyNote ${note.kind}`}>{note.text}</p>}
        <button className="smallButton ghost" onClick={onClose}>닫기</button>
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
  onAdjusted: (uid: string, patch: PointPatch) => void;
  onClose: () => void;
};

export default function PointRanking({ rows, hidden, season, syncedAt, myUid, isAdmin, inGame, onAdjusted, onClose }: Props) {
  const [managing, setManaging] = useState<string | null>(null);
  const managed = rows.find((row) => row.kakao_uid === managing);
  const [viewing, setViewing] = useState<string | null>(null);
  const viewed = rows.find((row) => row.kakao_uid === viewing);

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
                  <button className="pointRankManage gear" aria-label={`${row.name} 점수 관리`} onClick={() => setManaging(row.kakao_uid)}>⚙️</button>
                )}
                <span className="pointRankScore">
                  <strong>{row.exp.toLocaleString("ko-KR")}</strong>
                  <em>점{row.tickets ? ` · 🎫${row.tickets}` : ""}</em>
                </span>
                <button className="pointRankManage" aria-label={`${row.name} 점수 내역`} onClick={() => setViewing(row.kakao_uid)}>📜</button>
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
      {viewed && <PointHistoryBox key={viewed.kakao_uid} row={viewed} onClose={() => setViewing(null)} />}
    </div>
  );
}
