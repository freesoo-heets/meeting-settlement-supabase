"use client";

// 🃏 텍사스 홀덤 — 관리자 테스트판 (나 + 봇 3명, 연습용 칩 · 점수 · 티켓과 무관)
import { useEffect, useMemo, useState } from "react";
import { useGameViewport } from "./useGameViewport";
import {
  act,
  bestHand,
  botAction,
  HAND_NAME,
  legal,
  newTable,
  rankText,
  startHand,
  SUIT_ICON,
  type Card,
  type Table,
} from "../lib/holdem";

function CardView({ card, hidden, small }: { card?: Card; hidden?: boolean; small?: boolean }) {
  if (!card || hidden) return <span className={`hdCard back ${small ? "small" : ""}`} aria-label="뒤집힌 카드" />;
  const red = card.s === "h" || card.s === "d";
  return (
    <span className={`hdCard ${red ? "red" : ""} ${small ? "small" : ""}`} aria-label={`${SUIT_ICON[card.s]} ${rankText(card.r)}`}>
      <b>{rankText(card.r)}</b>
      <i>{SUIT_ICON[card.s]}</i>
    </span>
  );
}

export default function HoldemGame({ onClose, onBack, myName }: { onClose: () => void; onBack?: () => void; myName: string }) {
  useGameViewport();
  const [table, setTable] = useState<Table>(() => newTable(myName));
  const [raiseTo, setRaiseTo] = useState(0);

  const me = table.players[0];
  const myTurn = table.stage !== "showdown" && table.turn === 0;
  const pot = table.players.reduce((s, p) => s + p.total, 0);
  const info = myTurn ? legal(table) : null;
  const myHand = useMemo(
    () => (me.hole.length === 2 && table.board.length >= 3 ? HAND_NAME[bestHand([...me.hole, ...table.board]).score[0]] : ""),
    [me.hole, table.board],
  );

  // 봇 차례면 잠깐 생각한 뒤 행동
  useEffect(() => {
    if (table.stage === "showdown" || table.turn < 0 || !table.players[table.turn].bot) return;
    const timer = window.setTimeout(() => setTable((t) => (t.turn >= 0 && t.players[t.turn].bot ? act(t, botAction(t)) : t)), 700);
    return () => window.clearTimeout(timer);
  }, [table]);

  useEffect(() => {
    if (info) setRaiseTo(info.minRaiseTo);
  }, [table.turn, table.currentBet, table.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const alive = table.players.filter((p) => p.chips > 0).length;
  const handOver = table.stage === "showdown";
  const gameOver = handOver && (me.chips <= 0 || alive < 2);

  return (
    <div className="meetingModalBackdrop gameBackdrop" role="presentation">
      <section className="meetingModal gameModal hdModal" role="dialog" aria-modal="true" aria-label="텍사스 홀덤">
        <div className="meetingModalHeader">
          <div>
            <span>🧪 관리자 테스트 · 봇 3명과 연습 · 점수·티켓과 무관</span>
            <h2>🃏 텍사스 홀덤</h2>
          </div>
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="hdTable">
          <div className="hdSeats">
            {table.players.slice(1).map((p) => {
              const win = table.winners.find((w) => w.id === p.id);
              return (
                <div key={p.id} className={`hdSeat ${table.turn === p.id ? "turn" : ""} ${p.folded ? "folded" : ""} ${win ? "win" : ""}`}>
                  <strong>{p.name}{table.dealer === p.id ? " Ⓓ" : ""}</strong>
                  <span>💰 {p.chips}</span>
                  <div className="hdHole">
                    {p.hole.map((c, i) => <CardView key={i} card={c} hidden={!handOver || p.folded} small />)}
                  </div>
                  <em>{p.out ? "탈락" : p.folded ? "폴드" : p.allIn ? "올인" : p.bet ? `베팅 ${p.bet}` : " "}</em>
                </div>
              );
            })}
          </div>

          <div className="hdBoard">
            <div className="hdPot">팟 {pot}</div>
            <div className="hdCommunity">
              {Array.from({ length: 5 }, (_, i) => <CardView key={i} card={table.board[i]} hidden={!table.board[i]} />)}
            </div>
          </div>

          <div className={`hdMe ${myTurn ? "turn" : ""} ${table.winners.some((w) => w.id === 0) ? "win" : ""}`}>
            <div className="hdHole">{me.hole.map((c, i) => <CardView key={i} card={c} />)}</div>
            <div>
              <strong>{me.name}{table.dealer === 0 ? " Ⓓ" : ""}</strong>
              <span>💰 {me.chips}{me.bet ? ` · 베팅 ${me.bet}` : ""}{myHand ? ` · ${myHand}` : ""}</span>
            </div>
          </div>

          {myTurn && info && (
            <div className="hdActions">
              <button className="smallButton ghost danger" onClick={() => setTable((t) => act(t, { type: "fold" }))}>폴드</button>
              <button className="smallButton" onClick={() => setTable((t) => act(t, { type: info.canCheck ? "check" : "call" }))}>
                {info.canCheck ? "체크" : `콜 ${Math.min(info.toCall, me.chips)}`}
              </button>
              {info.minRaiseTo < info.maxTo && (
                <span className="hdRaise">
                  <input
                    type="range"
                    min={info.minRaiseTo}
                    max={info.maxTo}
                    step={10}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                    aria-label="레이즈 금액"
                  />
                  <button className="primaryButton" onClick={() => setTable((t) => act(t, { type: "raise", to: raiseTo }))}>레이즈 {raiseTo}</button>
                </span>
              )}
              <button className="smallButton ghost" onClick={() => setTable((t) => act(t, { type: "allin" }))}>올인</button>
            </div>
          )}

          {handOver && (
            <div className="hdNext">
              {gameOver ? (
                <>
                  <strong>{me.chips > 0 ? "🎉 모두 이겼어요!" : "😢 칩을 다 잃었어요"}</strong>
                  <button className="primaryButton" onClick={() => setTable(startHand(newTable(myName)))}>처음부터 다시</button>
                </>
              ) : (
                <button className="primaryButton" onClick={() => setTable((t) => startHand(t))}>
                  {table.handNo === 0 ? "▶ 게임 시작" : "▶ 다음 판"}
                </button>
              )}
            </div>
          )}

          <ol className="hdLog" aria-label="진행 기록">
            {table.log.slice(-8).map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </div>
      </section>
    </div>
  );
}
