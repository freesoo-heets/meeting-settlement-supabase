"use client";

// 🃏 텍사스 홀덤 (점수 내기 · 자유 입퇴장 · 2~6명)
// 앉을 때 봇이 💎 1,000점 · 🎫 1장을 차감하고, 일어나면 남은 칩을 점수로 돌려준다 (딴 금액의 5% 수수료)
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { BUY_IN, type Action, type Card, type Table } from "../lib/holdem";
import { copyInviteLink } from "./copyInvite";
import { useGameViewport } from "./useGameViewport";
import { HoldemTableView } from "./HoldemGame";

type TableRow = {
  id: string;
  status: "waiting" | "playing" | "closed";
  host_member: string;
  host_name: string;
  is_friendly: boolean;
  max_seats: number;
  view: Table;
  hand_no: number;
  turn_deadline: string | null;
  next_hand_at: string | null;
  created_at: string;
};
type SeatRow = {
  id: string;
  table_id: string;
  member_id: string;
  name: string;
  status: "escrow" | "seated" | "left" | "failed" | "cancelled";
  buy_in: number;
  is_friendly: boolean;
  escrow_state: string;
  escrow_note: string | null;
  cash_out: number | null;
  hands: number;
  settle_state: string;
  payout: number | null;
  fee: number | null;
  created_at: string;
  left_at: string | null;
  rebuy_state?: string;
  rebuy_note?: string | null;
  rebuy_want?: number | null;
  rebuy_total?: number;
};

const TABLE_COLUMNS = "id,status,host_member,host_name,is_friendly,max_seats,view,hand_no,turn_deadline,next_hand_at,created_at";
const SEAT_BASE = "id,table_id,member_id,name,status,buy_in,is_friendly,escrow_state,escrow_note,cash_out,hands,settle_state,payout,fee,created_at,left_at";
const SEAT_COLUMNS = `${SEAT_BASE},rebuy_state,rebuy_note,rebuy_want,rebuy_total`;
// 자리 기록 읽기 (충전 칸이 아직 DB에 없으면 그 칸 없이)
async function readSeats(build: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>) {
  const first = await build(SEAT_COLUMNS);
  const result = first.error?.code === "42703" ? await build(SEAT_BASE) : first;
  return ((result.data ?? []) as SeatRow[]);
}
const WIN_FEE = 0.05; // 봇(holdem_bridge.py HOLDEM_FEE)과 같아야 한다
const fmt = (n: number) => n.toLocaleString("ko-KR");

async function callHoldem(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." } as { ok: boolean; error?: string; id?: string; hole?: Card[]; handNo?: number };
  const response = await fetch("/api/holdem", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as {
    ok: boolean;
    error?: string;
    id?: string;
    hole?: Card[];
    handNo?: number;
  };
}

// 일어날 때 받는 점수 (친선은 점수 없음)
export function seatResult(seat: SeatRow) {
  const paid = seat.buy_in + (seat.rebuy_total ?? 0); // 바이인 + 충전
  const out = seat.cash_out ?? 0;
  const fee = seat.fee ?? (seat.hands > 0 ? Math.floor(Math.max(0, out - paid) * WIN_FEE) : 0);
  const back = seat.payout ?? out - fee;
  return { paid, out, fee, back, net: back - paid };
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n))}`;
const timeText = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

type Props = {
  onClose: () => void;
  onBack: () => void;
  currentMemberId: string;
  myPoints: number | null;
  myTickets: number | null;
  initialTableId?: string;
};

export default function HoldemOnline({ onClose, onBack, currentMemberId, myPoints, myTickets, initialTableId }: Props) {
  const [tableId, setTableId] = useState(initialTableId ?? "");
  if (tableId) {
    return <HoldemRoom key={tableId} tableId={tableId} currentMemberId={currentMemberId} onClose={onClose} onBack={() => setTableId("")} />;
  }
  return (
    <HoldemLobby
      currentMemberId={currentMemberId}
      myPoints={myPoints}
      myTickets={myTickets}
      onClose={onClose}
      onBack={onBack}
      onOpen={setTableId}
    />
  );
}

// ───────── 로비: 오목 · 알까기와 같은 모양 ─────────
function HoldemLobby({
  currentMemberId, myPoints, myTickets, onClose, onBack, onOpen,
}: {
  currentMemberId: string;
  myPoints: number | null;
  myTickets: number | null;
  onClose: () => void;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  useGameViewport();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [records, setRecords] = useState<SeatRow[]>([]);
  const [mine, setMine] = useState<SeatRow[]>([]);
  const [myActive, setMyActive] = useState<SeatRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const [t, r, m, a] = await Promise.all([
      supabase.from("holdem_tables").select(TABLE_COLUMNS).in("status", ["waiting", "playing"]).order("created_at", { ascending: false }).limit(20),
      readSeats((c) => supabase.from("holdem_seats").select(c).eq("status", "left").eq("is_friendly", false).order("left_at", { ascending: false }).limit(30)),
      readSeats((c) => supabase.from("holdem_seats").select(c).eq("status", "left").eq("is_friendly", false).eq("member_id", currentMemberId).order("left_at", { ascending: false }).limit(200)),
      readSeats((c) => supabase.from("holdem_seats").select(c).eq("member_id", currentMemberId).in("status", ["escrow", "seated"]).limit(1)),
    ]);
    setTables((t.data ?? []) as TableRow[]);
    setRecords(r);
    setMine(m);
    setMyActive(a[0] ?? null);
  }, [currentMemberId]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function run(payload: Record<string, unknown>, done?: (id?: string) => void) {
    setBusy(true);
    setMessage("");
    const result = await callHoldem(payload);
    setBusy(false);
    if (result.ok) done?.(result.id);
    else setMessage(result.error ?? "처리하지 못했습니다.");
    void load();
  }

  const playersOf = (table: TableRow) => (table.view?.players ?? []).filter((p) => !p.empty);
  const waiting = tables.filter((table) => table.status === "waiting");
  const playing = tables.filter((table) => table.status === "playing");
  const myNet = mine.reduce((sum, seat) => sum + seatResult(seat).net, 0);
  const shown = records.slice(0, showAll ? records.length : 8);

  const tableCard = (table: TableRow) => {
    const players = playersOf(table);
    const full = players.length >= table.max_seats;
    const mineHere = myActive?.table_id === table.id;
    return (
      <div className="omokCard" key={table.id}>
        <div>
          <strong>{table.host_name}님의 테이블</strong>
          <span>
            👥 {players.length}/{table.max_seats}명
            {table.status === "playing" ? ` · ${table.hand_no}번째 판` : ""}
            {players.length > 0 ? ` · ${players.map((p) => p.name).join(", ")}` : ""}
          </span>
        </div>
        <button
          className={`smallButton ${full && !mineHere ? "ghost" : ""}`}
          onClick={() => onOpen(table.id)}
        >
          {mineHere ? "입장" : full || myActive ? "관전" : "참가"}
        </button>
      </div>
    );
  };

  return (
    <div
      className="meetingModalBackdrop gameBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal omokModal gameModal" role="dialog" aria-modal="true">
        <div className="meetingModalHeader">
          <div>
            <span>바이인 {fmt(BUY_IN)}점 · 2~6명 · 티켓 1장씩</span>
            <h2>🃏 텍사스 홀덤</h2>
          </div>
          <div className="gameHeaderActions">
            <button className="smallButton ghost" onClick={onBack}>← 게임</button>
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        {message && <div className="omokMessage">{message}</div>}
        {info && !message && <div className="omokMessage info">{info}</div>}

        <div className="omokLobby">
          <div className="omokMine">
            <span>내 점수 <strong>💎 {myPoints !== null ? fmt(myPoints) : "-"}</strong></span>
            <span>티켓 <strong>🎫 {myTickets ?? "-"}</strong></span>
          </div>

          {myActive && (
            <div className="omokCard highlight">
              <div>
                <strong>{myActive.status === "escrow" ? "봇이 점수·티켓 확인 중…" : "테이블에 앉아 있어요"}</strong>
                <span>💎 바이인 {fmt(myActive.buy_in)}점</span>
              </div>
              <div className="omokCardActions">
                <button className="smallButton" onClick={() => onOpen(myActive.table_id)}>테이블 보기</button>
                <button className="smallButton inviteButton" disabled={busy} onClick={() => void run({ action: "invite", tableId: myActive.table_id }, () => setInfo("📣 카톡방에 초대 메시지를 보냈어요. (봇이 몇 초 안에 올립니다)"))}>
                  📣 카톡방
                </button>
                <button className="smallButton ghost" onClick={() => void copyInviteLink("holdem", myActive.table_id).then(setInfo)}>🔗 링크</button>
              </div>
            </div>
          )}

          {!myActive && (
            <div className="omokCreate">
              <strong>새 테이블</strong>
              <button className="primaryButton" disabled={busy} onClick={() => void run({ action: "create", friendly: false }, (id) => id && onOpen(id))}>
                테이블 만들기 · 💎 {fmt(BUY_IN)}점 · 🎫 1장
              </button>
              <small>
                앉을 때 {fmt(BUY_IN)}점 · 티켓 1장을 내고 칩 {fmt(BUY_IN)}개로 시작해요. 아무 때나 일어나면 남은 칩을 점수로
                돌려받습니다 (딴 금액의 5% 수수료). 한 판도 안 하고 일어나면 점수 · 티켓 모두 환불돼요.
              </small>
            </div>
          )}

          <div className="omokSection">
            <strong>대기 중인 테이블</strong>
            {waiting.length === 0 && <span className="muted">열린 테이블이 없습니다.</span>}
            {waiting.map(tableCard)}
          </div>

          {playing.length > 0 && (
            <div className="omokSection">
              <strong>진행 중</strong>
              {playing.map(tableCard)}
            </div>
          )}

          <div className="omokSection">
            <strong>
              내 기록 · {mine.length}번
              {mine.length > 0 && <> · 누적 <b className={myNet >= 0 ? "hdPlus" : "hdMinus"}>{signed(myNet)}점</b></>}
            </strong>
            {mine.length === 0 && <span className="muted">아직 기록이 없습니다.</span>}
            {mine.slice(0, 5).map((seat) => <RecordRow key={seat.id} seat={seat} />)}
          </div>

          {records.length > 0 && (
            <div className="omokSection">
              <strong>
                최근 결과
                {!showAll && records.length > 8 && (
                  <button className="smallButton ghost recentMore" onClick={() => setShowAll(true)}>더 보기</button>
                )}
              </strong>
              {shown.map((seat) => <RecordRow key={seat.id} seat={seat} showName />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function RecordRow({ seat, showName }: { seat: SeatRow; showName?: boolean }) {
  const r = seatResult(seat);
  return (
    <div className="omokResultRow hdRecordRow">
      <span>
        {showName ? `${r.net > 0 ? "🏆 " : ""}${seat.name} ` : ""}
        {seat.hands === 0 ? <b>환불</b> : <b className={r.net >= 0 ? "hdPlus" : "hdMinus"}>{signed(r.net)}점</b>}
      </span>
      <em>
        💎 {fmt(r.paid)} → {fmt(r.out)} · {seat.hands}판{r.fee > 0 ? ` · 수수료 ${fmt(r.fee)}` : ""}
        <br />
        {timeText(seat.left_at)}
      </em>
    </div>
  );
}

// ───────── 테이블 ─────────
function HoldemRoom({
  tableId, currentMemberId, onClose, onBack,
}: { tableId: string; currentMemberId: string; onClose: () => void; onBack: () => void }) {
  const [row, setRow] = useState<TableRow | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [hole, setHole] = useState<{ handNo: number; cards: Card[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase.from("holdem_tables").select(TABLE_COLUMNS).eq("id", tableId).maybeSingle(),
      readSeats((c) => supabase.from("holdem_seats").select(c).eq("table_id", tableId).order("created_at", { ascending: false }).limit(60)),
    ]);
    if (t.data) setRow(t.data as TableRow);
    setSeats(s);
  }, [tableId]);

  // 실시간 반영 (+ 끊겨도 5초마다)
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`holdem-${tableId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "holdem_tables", filter: `id=eq.${tableId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "holdem_seats", filter: `table_id=eq.${tableId}` }, () => void load())
      .subscribe();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load, tableId]);

  const view = row?.view;
  const meIndex = view?.players?.findIndex((p) => p.member === currentMemberId && !p.empty) ?? -1;
  const mySeat = seats.find((seat) => seat.member_id === currentMemberId && (seat.status === "escrow" || seat.status === "seated")) ?? null;
  const lastLeft = seats.find((seat) => seat.member_id === currentMemberId && seat.status === "left");
  const lastFailed = seats.find((seat) => seat.member_id === currentMemberId && seat.status === "failed");

  // 내 손패: 판이 바뀌면 받아 온다
  const handNo = view?.handNo ?? 0;
  const inHand = meIndex >= 0 && !!view && (view.players[meIndex]?.hole.length ?? 0) > 0;
  useEffect(() => {
    if (!inHand || hole?.handNo === handNo) return;
    let cancelled = false;
    void callHoldem({ action: "cards", tableId }).then((result) => {
      if (!cancelled && result.ok && result.handNo === handNo && result.hole?.length === 2) setHole({ handNo, cards: result.hole });
    });
    return () => {
      cancelled = true;
    };
  }, [inHand, handNo, hole?.handNo, tableId]);

  // 시간 초과 · 다음 판 · 새로 앉은 사람: 누구 화면이든 서버에 '진행' 요청 (봇도 따로 한다)
  const lastTick = useRef(0);
  useEffect(() => {
    if (!row || row.status === "closed") return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const deadline = row.turn_deadline ? new Date(row.turn_deadline).getTime() + 1600 : Infinity;
      const nextHand = row.next_hand_at ? new Date(row.next_hand_at).getTime() + 300 : Infinity;
      const left = new Set(row.view?.leftSeats ?? []);
      const newcomer = seats.some(
        (seat) => seat.status === "seated" && !left.has(seat.id) && !row.view?.players?.some((p) => p.seatId === seat.id),
      );
      const waitingStart = row.status === "waiting" && (row.view?.players ?? []).filter((p) => !p.empty && p.chips > 0).length >= 2;
      if ((now > deadline || now > nextHand || newcomer || waitingStart) && now - lastTick.current > 2500) {
        lastTick.current = now;
        void callHoldem({ action: "tick", tableId });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [row, seats, tableId]);

  async function run(payload: Record<string, unknown>, done?: () => void) {
    setBusy(true);
    setMessage("");
    const result = await callHoldem({ tableId, ...payload });
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "처리하지 못했습니다.");
    else done?.();
    void load();
  }
  const onAct = (action: Action) => void run({ action: "act", type: action.type, to: action.to ?? 0, handNo });

  if (!row || !view?.players) {
    return (
      <div className="meetingModalBackdrop gameBackdrop" role="presentation">
        <section className="meetingModal gameModal" role="dialog" aria-modal="true">
          <p className="muted">테이블을 불러오는 중…</p>
          <button className="smallButton ghost" onClick={onBack}>‹ 목록</button>
        </section>
      </div>
    );
  }

  const me = meIndex >= 0 ? view.players[meIndex] : null;
  const seatedCount = view.players.filter((p) => !p.empty).length;
  const pendingCount = seats.filter((seat) => seat.status === "escrow").length;
  const full = seatedCount + pendingCount >= row.max_seats;
  const money = row.is_friendly ? "🤝 친선 (점수 없음)" : `💎 바이인 ${fmt(BUY_IN)}점`;
  const closed = row.status === "closed";

  const inviteButtons = (
    <span className="hdInvite">
      <button className="smallButton inviteButton" disabled={busy} onClick={() => void run({ action: "invite" }, () => setInfo("📣 카톡방에 초대 메시지를 보냈어요. (봇이 몇 초 안에 올립니다)"))}>
        📣 카톡방에 초대
      </button>
      <button className="smallButton ghost" onClick={() => void copyInviteLink("holdem", tableId).then(setInfo)}>🔗 링크 복사</button>
    </span>
  );

  // 내 차례가 아닐 때 버튼 줄
  const idleBar = ({ handOver }: { handOver: boolean; resultShown: boolean }) => {
    if (closed) return <span className="hdWait">닫힌 테이블입니다</span>;
    if (!mySeat && !me) {
      return (
        <button className="next" disabled={busy || full} onClick={() => void run({ action: "sit" }, () => setInfo("🪑 자리를 신청했어요. 봇이 점수를 확인하면 앉습니다."))}>
          {full ? "자리가 다 찼어요 (관전 중)" : `앉기 · 💎 ${fmt(BUY_IN)}점 · 🎫 1장`}
        </button>
      );
    }
    if (mySeat?.status === "escrow") {
      return (
        <span className="hdWait">
          봇이 점수 · 티켓을 확인하는 중<i className="hdDots" aria-hidden="true" />
          <button className="smallButton ghost" disabled={busy} onClick={() => void run({ action: "leave" })}>취소</button>
        </span>
      );
    }
    if (row.status === "waiting") {
      return <span className="hdWait">참가자를 기다리는 중 ({seatedCount}명) · 2명부터 시작해요</span>;
    }
    if (handOver) return null;
    return null;
  };

  // 내 자리 버튼: 충전 · 나가기 예약 · 지금 일어나기
  const myChips = me ? me.chips + (me.pendingChips ?? 0) : 0;
  const rebuyBusy = mySeat?.rebuy_state === "requested" || mySeat?.rebuy_state === "locking";
  const seatTools = me ? (
    <div className="hdSeatTools">
      {me.leaving ? (
        <button className="smallButton" disabled={busy} onClick={() => void run({ action: "back" })}>↩ 계속하기</button>
      ) : (
        <>
          <button
            className="smallButton rebuy"
            disabled={busy || rebuyBusy || myChips >= BUY_IN}
            onClick={() => {
              const want = BUY_IN - myChips;
              if (!window.confirm(`칩을 ${fmt(BUY_IN)}개까지 채울까요?\n💎 ${fmt(want)}점이 듭니다. (점수가 모자라면 남은 점수 전부)\n판에 참여 중이면 이번 판이 끝난 뒤 들어와요.`)) return;
              void run({ action: "rebuy" }, () => setInfo("💎 충전을 신청했어요. 봇이 점수를 확인하면 칩이 들어옵니다."));
            }}
          >
            {rebuyBusy ? "충전 확인 중…" : myChips >= BUY_IN ? "💎 충전" : `💎 충전 +${fmt(BUY_IN - myChips)}`}
          </button>
          <button
            className={`smallButton ${me.standAfter ? "" : "ghost"}`}
            disabled={busy}
            onClick={() => void run({ action: "reserve" })}
          >
            {me.standAfter ? "⏳ 예약 취소" : "⏳ 나가기 예약"}
          </button>
          <button
            className="smallButton ghost stand"
            disabled={busy}
            onClick={() => {
              const inPlay = !me.folded && !me.out && view.stage !== "showdown";
              if (inPlay && !window.confirm("지금 판은 자동으로 폴드되고, 남은 칩을 점수로 돌려받습니다. 바로 일어날까요?\n(이번 판을 끝까지 하려면 '나가기 예약')")) return;
              void run({ action: "leave" }, () => setInfo("🚪 일어났어요. 남은 칩은 봇이 점수로 돌려줍니다."));
            }}
          >
            🚪 지금 일어나기
          </button>
        </>
      )}
    </div>
  ) : null;

  const lastLeftResult = lastLeft && !mySeat ? seatResult(lastLeft) : null;
  const notice = (
    <div className="hdNotice">
      {message && <div className="omokMessage">{message}</div>}
      {info && !message && <div className="omokMessage info">{info}</div>}
      {seatTools}
      {me?.standAfter && <div className="omokMessage info">⏳ 나가기 예약 · 이번 판이 끝나면 일어나고 남은 칩을 점수로 돌려받아요.</div>}
      {me && (me.pendingChips ?? 0) > 0 && <div className="omokMessage info">💎 충전한 칩 {fmt(me.pendingChips ?? 0)}개는 이번 판이 끝나면 들어와요.</div>}
      {mySeat?.rebuy_state === "failed" && mySeat.rebuy_note && <div className="omokMessage">충전 실패: {mySeat.rebuy_note}</div>}
      {lastFailed && !mySeat && !me && <div className="omokMessage">자리 신청 실패: {lastFailed.escrow_note}</div>}
      {lastLeft && lastLeftResult && !me && (
        <div className="omokMessage info">
          지난 자리 · {lastLeft.hands === 0 ? "한 판도 안 해서 💎 점수 · 🎫 티켓 모두 환불" : lastLeft.is_friendly ? `칩 ${fmt(lastLeftResult.out)} (친선)` : `💎 ${fmt(lastLeftResult.paid)} → ${fmt(lastLeftResult.out)} · ${signed(lastLeftResult.net)}점${lastLeftResult.fee ? ` (수수료 ${fmt(lastLeftResult.fee)})` : ""}`}
          {lastLeft.settle_state !== "done" && !lastLeft.is_friendly && " · 봇이 지급 중"}
        </div>
      )}
      {(row.status === "waiting" || seatedCount < row.max_seats) && !closed && inviteButtons}
    </div>
  );

  return (
    <HoldemTableView
      table={view}
      meIndex={meIndex}
      myHole={hole && hole.handNo === handNo ? hole.cards : null}
      onAct={onAct}
      busy={busy}
      deadline={row.turn_deadline ? new Date(row.turn_deadline).getTime() : null}
      title={`${row.is_friendly ? "🤝 " : ""}${row.host_name}님의 홀덤`}
      subtitle={`${money} · 블라인드 ${view.sb}/${view.bb}${handNo ? ` · ${handNo}번째 판` : ""} · ${seatedCount}/${row.max_seats}명${meIndex < 0 ? " · 관전 중" : ""}`}
      idleBar={idleBar}
      notice={notice}
      onClose={onClose}
      onBack={onBack}
    />
  );
}
