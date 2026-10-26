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

// ── 칩 그림 ──
// 금액을 칩 종류별로 나눠 기둥(최대 8개)으로 쌓는다. 새로 생긴 칩만 위에서 떨어지듯 내려앉는다.
const CHIP_KINDS = [
  { v: 500, cls: "purple" },
  { v: 100, cls: "black" },
  { v: 50, cls: "blue" },
  { v: 10, cls: "red" },
];
function chipColumns(amount: number, maxPerColumn = 8) {
  const cols: Array<{ cls: string; n: number }> = [];
  let left = amount;
  for (const kind of CHIP_KINDS) {
    let n = Math.floor(left / kind.v);
    left -= n * kind.v;
    while (n > 0) {
      const take = Math.min(maxPerColumn, n);
      cols.push({ cls: kind.cls, n: take });
      n -= take;
    }
  }
  if (left > 0 && cols.length === 0) cols.push({ cls: "red", n: 1 });
  return cols.slice(0, 9); // 너무 많으면 9기둥까지만 (팟이 아주 커도 화면이 넘치지 않게)
}
// 기둥 자리: 가운데에서 좌우 · 위아래로 조금씩 흩어 놓는다 (판마다 같은 자리)
const SPOTS = [
  [0, 0], [-26, 6], [26, 4], [-50, -2], [50, 8], [-14, -18], [16, -16], [-38, -20], [40, -14],
];
function ChipPile({ amount, className }: { amount: number; className: string }) {
  const cols = chipColumns(amount);
  return (
    <div className={`hdChips ${className}`} aria-hidden="true">
      {cols.map((col, c) => (
        <span
          key={`${c}-${col.cls}`}
          className="hdChipCol"
          style={{ transform: `translate(${SPOTS[c % SPOTS.length][0]}px, ${SPOTS[c % SPOTS.length][1]}px)` }}
        >
          {Array.from({ length: col.n }, (_, k) => (
            <i key={k} className={`hdChip ${col.cls}`} style={{ bottom: k * 3.5, animationDelay: `${(k % 4) * 40}ms` }} />
          ))}
        </span>
      ))}
    </div>
  );
}
const SEAT_POS = ["me", "left", "top", "right"] as const; // 0=나(아래), 1=왼쪽, 2=위, 3=오른쪽

export default function HoldemGame({ onClose, onBack, myName }: { onClose: () => void; onBack?: () => void; myName: string }) {
  useGameViewport();
  const [table, setTable] = useState<Table>(() => newTable(myName));

  // ★ 긴장감: 공용 카드는 한 장씩 천천히(턴 · 리버는 더 뜸 들여서), 쇼다운은 한 명씩 공개
  const [boardShown, setBoardShown] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [revealDone, setRevealDone] = useState(true);
  // ★ 처음 카드 받기: 딜러 다음 자리부터 한 장씩 돌려 나눠 주고(2바퀴), 내 카드는 뒤집힌 채 받은 뒤 한 장씩 천천히 쪼아 본다
  const [dealt, setDealt] = useState(0);
  const [myPeek, setMyPeek] = useState(0);
  useEffect(() => {
    setBoardShown(0);
    setRevealed(0);
    setRevealDone(false);
    setDealt(0);
    setMyPeek(0);
  }, [table.handNo]);
  const dealOrder = useMemo(() => {
    const seats = table.players.filter((p) => p.hole.length > 0).map((p) => p.id);
    const start = seats.findIndex((id) => id > table.dealer);
    const rotated = start < 0 ? seats : [...seats.slice(start), ...seats.slice(0, start)];
    return [...rotated, ...rotated]; // 두 바퀴
  }, [table.handNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const dealTotal = table.handNo > 0 ? dealOrder.length : 0;
  useEffect(() => {
    if (dealt < dealTotal) {
      const timer = window.setTimeout(() => setDealt((n) => n + 1), dealt === 0 ? 500 : 230);
      return () => window.clearTimeout(timer);
    }
    if (dealTotal > 0 && myPeek < 2) {
      // 다 받은 뒤 잠깐 멈췄다가 첫 장, 조금 더 뜸 들여 두 번째 장
      const timer = window.setTimeout(() => setMyPeek((n) => n + 1), myPeek === 0 ? 800 : 1100);
      return () => window.clearTimeout(timer);
    }
  }, [dealt, dealTotal, myPeek]);
  const dealtTo = (id: number) => dealOrder.slice(0, dealt).filter((x) => x === id).length;
  const dealDone = dealt >= dealTotal && (dealTotal === 0 || myPeek >= 2);
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
  const myTurn = table.stage !== "showdown" && table.turn === 0 && boardReady && dealDone;
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
    if (handOver || table.turn < 0 || !table.players[table.turn].bot || !boardReady || !dealDone) return;
    const timer = window.setTimeout(() => setTable((t) => (t.turn >= 0 && t.players[t.turn].bot ? act(t, botAction(t)) : t)), 750);
    return () => window.clearTimeout(timer);
  }, [table, handOver, boardReady, dealDone]);

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

  // 쇼다운 때 각자 어떤 메이드인지 (공개된 사람만)
  const madeOf = (id: number) => {
    const p = table.players[id];
    if (!handOver || !contested || p.folded || p.out || p.hole.length < 2 || table.board.length < 5) return "";
    if (id !== 0 && !isRevealed(id) && !resultShown) return "";
    return HAND_NAME[bestHand([...p.hole, ...table.board]).score[0]];
  };
  const lastLine = table.log.filter((line) => resultShown || !line.startsWith("🏆")).slice(-1)[0] ?? "";
  const roleOf = (id: number) =>
    table.dealer === id ? "D" : !handOver && sbSeat === id ? "SB" : !handOver && bbSeat === id ? "BB" : "";

  return (
    <div className="meetingModalBackdrop gameBackdrop" role="presentation">
      <section className="meetingModal gameModal hdModal" role="dialog" aria-modal="true" aria-label="텍사스 홀덤">
        <header className="hdTop">
          {onBack && <button className="hdIconBtn" onClick={onBack} aria-label="게임 목록으로">‹</button>}
          <div className="hdTitle">
            <strong>텍사스 홀덤</strong>
            <span>블라인드 {table.sb}/{table.bb}{table.handNo ? ` · ${table.handNo}번째 판` : ""} · 연습 칩</span>
          </div>
          <button className="hdIconBtn" onClick={onClose} aria-label="닫기">×</button>
        </header>

        <div className="hdFelt">
          <div className="hdRail">
            {/* 가운데: 팟 · 공용 카드 */}
            <div className="hdCenter">
              <div className="hdPot"><span>POT</span><b>{fmt(pot)}</b></div>
              <div className="hdPotArea">
                {!resultShown && <ChipPile amount={pot - table.players.reduce((sum, q) => sum + q.bet, 0)} className="pot" />}
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
              </div>
              <div className="hdCenterNote">
                {handOver && !revealDone && contested && boardReady ? (
                  <span className="hdSuspense">SHOWDOWN</span>
                ) : resultShown && table.winners.length > 0 ? (
                  <span className="hdWinner">
                    {table.winners.map((w) => `${table.players[w.id].name.replace("🤖 ", "")} +${fmt(w.amount)} · ${w.hand}`).join("  /  ")}
                  </span>
                ) : null}
              </div>
            </div>

            {/* 상대 자리 */}
            {table.players.map((p, i) => {
              if (i === 0) return null;
              const win = resultShown && table.winners.some((w) => w.id === p.id);
              const lost = resultShown && contested && !win && !p.folded && !p.out;
              const made = madeOf(p.id);
              const status = p.out ? "탈락" : p.folded ? "폴드" : p.allIn ? "올인" : "";
              const role = roleOf(p.id);
              return (
                <div key={p.id} className={`hdSeat ${SEAT_POS[i]} ${table.turn === p.id && !handOver && dealDone ? "turn" : ""} ${p.folded || p.out ? "folded" : ""} ${win ? "win" : ""} ${lost ? "lost" : ""}`}>
                  <div className="hdTags">
                    {win && <span className="hdWinTag">👑 WIN +{fmt(wonAmount(p.id))}</span>}
                    {made && <span className={`hdMade ${win ? "win" : ""}`}>{made}</span>}
                  </div>
                  <div className={`hdSeatCards ${isRevealed(p.id) ? "open" : ""}`}>
                    {p.hole.slice(0, handOver ? 2 : dealtTo(p.id)).map((c, k) => (
                      <span key={`${table.handNo}-${k}`} className="hdDealIn from-center">
                        <CardView key={`${k}-${isRevealed(p.id)}`} card={c} hidden={!isRevealed(p.id)} size="sm" />
                      </span>
                    ))}
                  </div>
                  <div className="hdPill">
                    <span className="hdAvatar">{p.name.replace("🤖 ", "").slice(0, 1)}</span>
                    <span className="hdPillText">
                      <span>{p.name.replace("🤖 ", "")}</span>
                      <b>{fmt(chipsShown(p.id))}</b>
                    </span>
                    {role && <span className={`hdRole ${role.toLowerCase()}`}>{role}</span>}
                    {status && <span className={`hdStatus ${status === "올인" ? "allin" : ""}`}>{status}</span>}
                  </div>
                  {p.bet > 0 && (
                    <div className="hdBet">
                      <ChipPile amount={p.bet} className="bet" />
                      <span>{fmt(p.bet)}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* 내 베팅 (테이블 안쪽 아래) */}
            {me.bet > 0 && (
              <div className="hdBet mine">
                <ChipPile amount={me.bet} className="bet" />
                <span>{fmt(me.bet)}</span>
              </div>
            )}
          </div>

          {/* 나 */}
          <div className={`hdMe ${myTurn ? "turn" : ""} ${resultShown && table.winners.some((w) => w.id === 0) ? "win" : ""} ${resultShown && contested && !table.winners.some((w) => w.id === 0) && !me.folded ? "lost" : ""}`}>
            <div className="hdTags me">
              {resultShown && table.winners.some((w) => w.id === 0) && <span className="hdWinTag">👑 WIN +{fmt(wonAmount(0))}</span>}
              {madeOf(0) && resultShown && <span className={`hdMade ${table.winners.some((w) => w.id === 0) ? "win" : ""}`}>{madeOf(0)}</span>}
            </div>
            <div className="hdMyCards">
              {me.hole.slice(0, handOver ? 2 : dealtTo(0)).map((c, i) => (
                <span key={`${table.handNo}-${i}`} className="hdDealIn mine">
                  {myPeek > i || handOver ? (
                    <span className="hdPeek"><CardView card={c} size="lg" lit={resultShown && inBest(c)} /></span>
                  ) : (
                    <CardView card={c} size="lg" hidden />
                  )}
                </span>
              ))}
            </div>
            <div className="hdPill me">
              <span className="hdAvatar">{me.name.slice(0, 1)}</span>
              <span className="hdPillText">
                <span>{best ? HAND_NAME[best.score[0]] : me.name}</span>
                <b>{fmt(chipsShown(0))}</b>
              </span>
              {roleOf(0) && <span className={`hdRole ${roleOf(0).toLowerCase()}`}>{roleOf(0)}</span>}
            </div>
          </div>
        </div>

        {/* 행동 버튼 */}
        <div className="hdBar">
          {myTurn && info ? (
            <>
              <button className="fold" onClick={() => setTable((t) => act(t, { type: "fold" }))}>폴드</button>
              <button className="call" onClick={() => setTable((t) => act(t, { type: info.canCheck ? "check" : "call" }))}>
                {info.canCheck ? "체크" : <>콜 <small>{fmt(Math.min(info.toCall, me.chips))}</small></>}
              </button>
              <button disabled={info.minRaiseTo >= info.maxTo} onClick={() => raise(sized(0.25))}>쿼터</button>
              <button disabled={info.minRaiseTo >= info.maxTo} onClick={() => raise(sized(0.5))}>하프</button>
              <button disabled={info.minRaiseTo >= info.maxTo} onClick={() => raise(sized(1))}>풀</button>
              <button className="allin" onClick={() => setTable((t) => act(t, { type: "allin" }))}>올인</button>
            </>
          ) : handOver && resultShown ? (
            gameOver ? (
              <button className="next" onClick={() => setTable(startHand(newTable(myName)))}>
                {me.chips > 0 ? "모두 이겼어요 · 처음부터 다시" : "칩을 다 잃었어요 · 처음부터 다시"}
              </button>
            ) : (
              <button className="next" onClick={() => setTable((t) => startHand(t))}>{table.handNo === 0 ? "게임 시작" : "다음 판"}</button>
            )
          ) : (
            <span className="hdWait">
              {handOver ? "카드를 공개하는 중" : !dealDone ? (dealt < dealTotal ? "카드를 나눠 주는 중" : "내 카드 확인 중") : !boardReady ? "카드를 까는 중" : table.turn >= 0 ? `${table.players[table.turn].name.replace("🤖 ", "")} 생각 중` : ""}
              <i className="hdDots" aria-hidden="true" />
            </span>
          )}
        </div>
        <p className="hdLastLine" aria-live="polite">{lastLine}</p>
      </section>
    </div>
  );
}
