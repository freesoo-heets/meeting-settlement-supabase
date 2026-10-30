"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { TICKET_PRICE } from "../lib/wordGame";

// 🎫 게임 목록에서 바로 티켓 구매 (카톡 !티켓구매 와 같음. 봇이 점수를 빼고 티켓을 넣는다)

type Order = { state: string; reason: string | null; cost: number | null; exp_after: number | null; tickets_after: number | null };
type CallResult = { ok: boolean; error?: string; id?: string; order?: Order };

async function callTicket(payload: Record<string, unknown>): Promise<CallResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as CallResult;
}

const fmt = (n: number) => n.toLocaleString("ko-KR");
const MAX = 20;
const POLL_MS = 2000;
const POLL_TRIES = 30; // 1분

type Props = {
  myPoints: number | null;
  myTickets: number | null;
  onBought: (exp: number, tickets: number) => void;
  onClose: () => void;
};

export default function TicketBuy({ myPoints, myTickets, onBought, onClose }: Props) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err" | "wait"; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const cost = count * TICKET_PRICE;
  const affordable = myPoints === null ? MAX : Math.max(0, Math.min(MAX, Math.floor(myPoints / TICKET_PRICE)));
  const short = myPoints !== null && myPoints < cost;
  const done = note?.kind === "ok";

  async function buy() {
    setBusy(true);
    setNote({ kind: "wait", text: "⏳ 구매 요청 중… 봇이 확인하면 바로 들어옵니다." });
    const res = await callTicket({ action: "buy", count });
    if (!res.ok || !res.id) {
      setBusy(false);
      setNote({ kind: "err", text: `❌ ${res.error ?? "구매하지 못했습니다."}` });
      return;
    }
    for (let i = 0; i < POLL_TRIES && alive.current; i += 1) {
      await new Promise((r) => window.setTimeout(r, POLL_MS));
      const st = await callTicket({ action: "status", id: res.id });
      const order = st.order;
      if (!order) continue;
      if (order.state === "done") {
        setBusy(false);
        setNote({
          kind: "ok",
          text: `✅ 구매 완료! 🎫 +${count}장 (총 ${order.tickets_after ?? "-"}장)\n💎 -${fmt(order.cost ?? cost)}점 (남은 점수 ${order.exp_after !== null ? fmt(order.exp_after) : "-"}점)`,
        });
        if (order.exp_after !== null && order.tickets_after !== null) onBought(order.exp_after, order.tickets_after);
        return;
      }
      if (order.state === "failed") {
        setBusy(false);
        setNote({ kind: "err", text: `❌ ${order.reason ?? "구매하지 못했습니다."}` });
        return;
      }
    }
    if (!alive.current) return;
    setBusy(false);
    setNote({ kind: "wait", text: "⚠️ 봇이 아직 처리하지 못했어요. 봇이 켜지면 자동으로 들어갑니다. 잠시 뒤 점수를 확인해 주세요." });
  }

  return (
    <div className="ticketBuyBack" onClick={onClose}>
      <div className="ticketBuyBox" role="dialog" aria-modal="true" aria-label="티켓 구매" onClick={(e) => e.stopPropagation()}>
        <strong>🎫 티켓 구매</strong>
        <p className="ticketBuyHave">
          내 점수 💎 {myPoints !== null ? fmt(myPoints) : "-"} · 티켓 🎫 {myTickets ?? "-"}
        </p>
        {!done && (
          <>
            <div className="ticketBuyStepper">
              <button disabled={busy || count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="한 장 빼기">−</button>
              <span><b>{count}</b>장</span>
              <button disabled={busy || count >= MAX} onClick={() => setCount((c) => Math.min(MAX, c + 1))} aria-label="한 장 더하기">＋</button>
            </div>
            <div className="ticketBuyQuick">
              {[1, 5, 10].map((n) => (
                <button key={n} className={count === n ? "on" : ""} disabled={busy} onClick={() => setCount(n)}>{n}장</button>
              ))}
              <button disabled={busy || affordable < 1} onClick={() => setCount(Math.max(1, affordable))}>최대</button>
            </div>
            <p className={`ticketBuyCost ${short ? "short" : ""}`}>
              1장 {TICKET_PRICE}점 × {count}장 = <b>{fmt(cost)}점</b>
              {short && <><br />점수가 부족해요</>}
            </p>
          </>
        )}
        {note && <p className={`ticketBuyNote ${note.kind}`}>{note.text}</p>}
        <div className="ticketBuyButtons">
          {!done && (
            <button className="ticketBuyGo" disabled={busy || short} onClick={() => void buy()}>
              {busy ? "처리 중…" : `${fmt(cost)}점으로 구매`}
            </button>
          )}
          <button className="smallButton ghost" onClick={onClose}>{done || busy ? "닫기" : "취소"}</button>
        </div>
      </div>
    </div>
  );
}
