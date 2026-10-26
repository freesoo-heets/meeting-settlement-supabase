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

// 카드 앞면: 왼쪽 위 숫자 · 무늬, 가운데 큰 무늬. ♥♦ 빨강, ♠♣ 검정
function CardView({ card, hidden, size = "md", lit, slow }: { card?: Card; hidden?: boolean; size?: "sm" | "md" | "lg"; lit?: boolean; slow?: boolean }) {
  if (!card) return <div className={`hdCard empty ${size}`} aria-hidden="true" />;
  if (hidden) return <div className={`hdCard back ${size}`} aria-label="뒤집힌 카드" />;
  const red = card.s === "h" || card.s === "d";
  return (
    <div className={`hdCard face flipIn ${slow ? "slow" : ""} ${red ? "red" : "black"} ${size} ${lit ? "lit" : ""}`} aria-label={`${SUIT_ICON[card.s]} ${rankText(card.r)}`}>
      <div className="hdCorner">
        <b>{rankText(card.r)}</b>
        <i>{SUIT_ICON[card.s]}</i>
      </div>
      <div className="hdPip">{SUIT_ICON[card.s]}</div>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("ko-KR");
const SEAT_POS = ["me", "left", "top", "right"] as const; // 0=나(아래), 1=왼쪽, 2=위, 3=오른쪽

export default function HoldemGame({ onClose, onBack, myName }: { onClose: () => void; onBack?: () => void; myName: string }) {
  useGameViewport();
  const [table, setTable] = useState<Table>(() => newTable(myName));

  // ★ 긴장감: 공용 카드는 한 장씩 천천히(턴 · 리버는 더 뜸 들여서), 쇼다운은 한 명씩 공개
  const [boardShown, setBoardShown] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [revealDone, setRevealDone] = useState(true);
  useEffect(() => {
    setBoardShown(0);
    setRevealed(0);
    setRevealDone(false);
  }, [table.handNo]);
  useEffect(() => {
    if (boardShown >= table.board.length) return;
    // 플랍 첫 장 0.7초, 플랍 나머지 0.45초씩, 턴 · 리버는 1.4초 뜸
    const delay = boardShown === 0 ? 700 : boardShown < 3 ? 450 : 1400;
    const timer = window.setTimeout(() => setBoardShown((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [boardShown, table.board.length]);
  const boardReady = boardShown >= table.board.length;
  const showdownSeats = table.players.filter((p) => p.id !== 0 && !p.out && !p.folded && p.hole.length > 0).map((p) => p.id);
  const contested = table.stage === "showdown" && table.players.filter((p) => !p.out && !p.folded).length > 1;
  useEffect(() => {
    if (table.stage !== "showdown") return;
    if (!contested) {
      setRevealDone(true);
      return;
    }
    if (!boardReady) {
      setRevealDone(false);
      return;
    }
    if (revealed < showdownSeats.length) {
      setRevealDone(false);
      const timer = window.setTimeout(() => setRevealed((n) => n + 1), revealed === 0 ? 900 : 1000);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setRevealDone(true), 700);
    return () => window.clearTimeout(timer);
  }, [table.stage, contested, boardReady, revealed, showdownSeats.length]);
  const isRevealed = (id: number) => showdownSeats.indexOf(id) > -1 && showdownSeats.indexOf(id) < revealed;
  const wonAmount = (id: number) => table.winners.find((w) => w.id === id)?.amount ?? 0;
  // 공개가 끝나기 전에는 딴 칩을 빼고 보여준다 (결과를 미리 알 수 없게)
  const chipsShown = (id: number) =>
    table.players[id].chips - (table.stage === "showdown" && contested && !(boardShown >= table.board.length && revealed >= showdownSeats.length && revealDone) ? wonAmount(id) : 0);

  const me = table.players[0];
  const myTurn = table.stage !== "showdown" && table.turn === 0 && boardReady;
  const handOver = table.stage === "showdown";
  // 결과(승자 · 칩)는 모두 공개된 뒤에만. 모두 폴드한 판은 바로
  const resultShown = handOver && (!contested || (boardReady && revealed >= showdownSeats.length && revealDone));
  const pot = table.players.reduce((s, p) => s + p.total, 0);
  const info = myTurn ? legal(table) : null;
  const visibleBoard = table.board.slice(0, boardShown);
  const best = useMemo(
    () => (me.hole.length === 2 && visibleBoard.length >= 3 ? bestHand([...me.hole, ...visibleBoard]) : null),
    [me.hole, visibleBoard.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // 내 족보에 쓰인 카드에 테두리
  const inBest = (c: Card) => !!best?.cards.some((b) => b.r === c.r && b.s === c.s);

  // 봇 차례면 잠깐 생각한 뒤 행동
  useEffect(() => {
    if (handOver || table.turn < 0 || !table.players[table.turn].bot || !boardReady) return;
    const timer = window.setTimeout(() => setTable((t) => (t.turn >= 0 && t.players[t.turn].bot ? act(t, botAction(t)) : t)), 750);
    return () => window.clearTimeout(timer);
  }, [table, handOver, boardReady]);

  // 쿼터 · 하프 · 풀(팟): 콜 금액 + 팟의 1/4 · 1/2 · 전부만큼 올린다
  const sized = (frac: number) => {
    if (!info) return 0;
    const to = table.currentBet + Math.round(((pot + info.toCall) * frac) / 10) * 10;
    return Math.min(info.maxTo, Math.max(info.minRaiseTo, to));
  };
  const raise = (to: number) => setTable((t) => act(t, to >= (info?.maxTo ?? 0) ? { type: "allin" } : { type: "raise", to }));

  const alive = table.players.filter((p) => p.chips > 0).length;
  const gameOver = handOver && (me.chips <= 0 || alive < 2);
  const sbSeat = (() => {
    const seated = table.players.filter((p) => !p.out).map((p) => p.id);
    if (seated.length === 2) return table.dealer;
    const i = seated.indexOf(table.dealer);
    return seated[(i + 1) % seated.length];
  })();
  const bbSeat = (() => {
    const seated = table.players.filter((p) => !p.out).map((p) => p.id);
    const i = seated.indexOf(sbSeat);
    return seated[(i + 1) % seated.length];
  })();

  return (
    <div className="meetingModalBackdrop gameBackdrop" role="presentation">
      <section className="meetingModal gameModal hdModal" role="dialog" aria-modal="true" aria-label="텍사스 홀덤">
        <div className="hdTop">
          <span className="hdBlind">SB {table.sb} · BB {table.bb} · {table.handNo}번째 판</span>
          <span className="hdTag">🧪 관리자 테스트 · 연습 칩</span>
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="hdFelt">
          <div className="hdRail">
            {/* 가운데: 팟 · 공용 카드 */}
            <div className="hdCenter">
              <div className="hdPot">
                <span className="hdChipStack" aria-hidden="true"><i /><i /><i /></span>
                <b>{fmt(pot)}</b>
              </div>
              <div className="hdCommunity">
                {Array.from({ length: 5 }, (_, i) => (
                  <CardView
                    key={`${table.handNo}-${i}-${i < boardShown}`}
                    card={i < boardShown ? table.board[i] : undefined}
                    slow={i >= 3}
                    lit={i < boardShown && resultShown && inBest(table.board[i])}
                  />
                ))}
              </div>
              {handOver && !revealDone && contested && boardReady && <div className="hdSuspense">쇼다운…</div>}
              {resultShown && table.winners.length > 0 && (
                <div className="hdWinner">
                  🏆 {table.winners.map((w) => `${table.players[w.id].name} +${fmt(w.amount)} (${w.hand})`).join(" · ")}
                </div>
              )}
            </div>

            {/* 자리 */}
            {table.players.map((p, i) => {
              if (i === 0) return null;
              const win = resultShown && table.winners.some((w) => w.id === p.id);
              const badge = p.out ? "탈락" : p.folded ? "폴드" : p.allIn ? "올인" : "";
              return (
                <div key={p.id} className={`hdSeat ${SEAT_POS[i]} ${table.turn === p.id ? "turn" : ""} ${p.folded ? "folded" : ""} ${win ? "win" : ""}`}>
                  <div className={`hdAvatar ${badge ? `badge ${badge === "올인" ? "allin" : ""}` : ""}`}>{badge || p.name.slice(0, 2)}</div>
                  <div className="hdPlate">
                    <span>{p.name.replace("🤖 ", "")}</span>
                    <b>{fmt(chipsShown(p.id))}</b>
                  </div>
                  <div className={`hdSeatCards ${isRevealed(p.id) ? "open" : ""}`}>
                    {p.hole.map((c, k) => (
                      <CardView key={`${k}-${isRevealed(p.id)}`} card={c} hidden={!isRevealed(p.id)} size={isRevealed(p.id) ? "md" : "sm"} />
                    ))}
                  </div>
                  {p.bet > 0 && <div className="hdBet">{fmt(p.bet)}</div>}
                  {table.dealer === p.id && <span className="hdMarker d">D</span>}
                  {!handOver && sbSeat === p.id && <span className="hdMarker sb">SB</span>}
                  {!handOver && bbSeat === p.id && <span className="hdMarker bb">BB</span>}
                </div>
              );
            })}
          </div>

          {/* 나 */}
          <div className={`hdMe ${myTurn ? "turn" : ""} ${resultShown && table.winners.some((w) => w.id === 0) ? "win" : ""}`}>
            <div className="hdMyCards">
              {me.hole.map((c, i) => <CardView key={`${table.handNo}-${i}`} card={c} size="lg" lit={resultShown && inBest(c)} />)}
            </div>
            <div className="hdMyInfo">
              {best && <span className="hdHandName">♠ {HAND_NAME[best.score[0]]}</span>}
              <b>{fmt(chipsShown(0))}</b>
              {me.bet > 0 && <em>베팅 {fmt(me.bet)}</em>}
              {table.dealer === 0 && <span className="hdMarker d inline">D</span>}
            </div>
          </div>
        </div>

        {/* 아래 행동 버튼 (카지노 앱처럼 한 줄) */}
        <div className="hdBar">
          {myTurn && info ? (
            <>
              {info.minRaiseTo < info.maxTo ? (
                <>
                  <button onClick={() => raise(sized(0.25))}>쿼터</button>
                  <button onClick={() => raise(sized(0.5))}>하프</button>
                </>
              ) : (
                <><button disabled>쿼터</button><button disabled>하프</button></>
              )}
              <button className="call" onClick={() => setTable((t) => act(t, { type: info.canCheck ? "check" : "call" }))}>
                {info.canCheck ? "체크" : `콜 ${fmt(Math.min(info.toCall, me.chips))}`}
              </button>
              {info.minRaiseTo < info.maxTo ? <button onClick={() => raise(sized(1))}>풀</button> : <button disabled>풀</button>}
              <button className="allin" onClick={() => setTable((t) => act(t, { type: "allin" }))}>올인</button>
              <button className="fold" onClick={() => setTable((t) => act(t, { type: "fold" }))}>폴드</button>
            </>
          ) : handOver && resultShown ? (
            gameOver ? (
              <button className="next" onClick={() => setTable(startHand(newTable(myName)))}>
                {me.chips > 0 ? "🎉 모두 이겼어요! 처음부터 다시" : "😢 칩을 다 잃었어요 · 처음부터 다시"}
              </button>
            ) : (
              <button className="next" onClick={() => setTable((t) => startHand(t))}>{table.handNo === 0 ? "▶ 게임 시작" : "▶ 다음 판"}</button>
            )
          ) : (
            <span className="hdWait">
              {handOver ? "카드를 공개하는 중…" : !boardReady ? "카드를 까는 중…" : table.turn >= 0 ? `${table.players[table.turn].name.replace("🤖 ", "")} 생각 중…` : ""}
            </span>
          )}
        </div>

        <ol className="hdLog" aria-label="진행 기록">
          {table.log.filter((line) => resultShown || !line.startsWith("🏆")).slice(-6).map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </section>
    </div>
  );
}
