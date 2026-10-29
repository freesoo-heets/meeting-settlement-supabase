"use client";

// 🃏 텍사스 홀덤 — 테이블 화면(연습판 · 온라인 공용) + 🤖 연습판
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGameViewport } from "./useGameViewport";
import { useGameSound } from "./gameSound";
import { EMOTES, EmoteIcon, type EmoteKind } from "./OmokEmotes";
import {
  sndBoard, sndDeal, sndFlip, sndForLog, sndHurry, sndLose, sndMyTurn, sndPot, sndShowdown, sndWin,
} from "./holdemSound";
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
  type Action,
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

// ── 족보 순위표 ──
// 예시 카드: 앞의 key 장이 족보를 이루는 카드, 나머지는 흐리게
const RANK_EXAMPLES: Array<{ rank: number; cards: string; key: number }> = [
  { rank: 8, cards: "9h 8h 7h 6h 5h", key: 5 },
  { rank: 7, cards: "13s 13h 13d 13c 7s", key: 4 },
  { rank: 6, cards: "12s 12h 12d 9c 9s", key: 5 },
  { rank: 5, cards: "14d 11d 8d 6d 3d", key: 5 },
  { rank: 4, cards: "10c 9d 8s 7h 6c", key: 5 },
  { rank: 3, cards: "7s 7h 7d 13c 2s", key: 3 },
  { rank: 2, cards: "11s 11h 4d 4c 14s", key: 4 },
  { rank: 1, cards: "14s 14h 13d 8c 4s", key: 2 },
  { rank: 0, cards: "14c 12d 9s 6h 3c", key: 1 },
];
function HandRanks({ current, onClose }: { current?: number; onClose?: () => void }) {
  return (
    <aside className="hdRanks" aria-label="족보 순위">
      <div className="hdRanksHead">
        <strong>족보 순위</strong>
        <span>위가 더 강해요</span>
        {onClose && <button className="hdIconBtn sm" onClick={onClose} aria-label="족보 닫기">×</button>}
      </div>
      <ol>
        {RANK_EXAMPLES.map((row, i) => (
          <li key={row.rank} className={current === row.rank ? "mine" : ""}>
            <span className="hdRankNo">{i + 1}</span>
            <span className="hdRankName">{HAND_NAME[row.rank]}</span>
            <span className="hdMinis">
              {row.cards.split(" ").map((code, k) => {
                const suit = code.slice(-1) as Card["s"];
                const red = suit === "h" || suit === "d";
                return (
                  <i key={k} className={`hdMini ${red ? "red" : ""} ${k >= row.key ? "kicker" : ""}`}>
                    <b>{rankText(Number(code.slice(0, -1)))}</b>
                    {SUIT_ICON[suit]}
                  </i>
                );
              })}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

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
// 자리 배치: 나(아래)부터 시계 방향(왼쪽 → 위 → 오른쪽)
const SEAT_POS_4 = ["me", "left", "top", "right"];
const SEAT_POS_6 = ["me", "left low", "left high", "top", "right high", "right low"];
const shortName = (name: string) => name.replace("🤖 ", "");

export type IdleInfo = { handOver: boolean; resultShown: boolean };

type ViewProps = {
  table: Table;
  meIndex: number;              // 내 자리 (-1 = 관전: 0번 자리를 아래에)
  myHole?: Card[] | null;       // 내 손패 (온라인은 API 로 받은 것)
  onAct?: (action: Action) => void;
  busy?: boolean;               // 행동 보내는 중
  deadline?: number | null;     // 지금 차례 마감 시각(ms)
  title: string;
  subtitle: string;
  headerExtra?: ReactNode;
  idleBar?: (info: IdleInfo) => ReactNode; // 내 차례가 아닐 때 버튼 줄 (없으면 안내 문구)
  notice?: ReactNode;           // 버튼 줄 아래 안내
  onReady?: (ready: boolean) => void; // 연출이 끝나 다음 행동을 해도 될 때
  onClose: () => void;
  onBack?: () => void;
  emotes?: HoldemEmote[];       // 떠 있는 감정표현 (오목과 같은 스티커)
  onEmote?: (kind: EmoteKind) => void;
  emoteReadyIn?: number;        // 다시 보낼 수 있을 때까지 남은 ms
};

export type HoldemEmote = { key: number; kind: EmoteKind; member: string; name: string };

function EmotePop({ emote, watcher }: { emote: HoldemEmote; watcher?: boolean }) {
  return (
    <div className={`hdEmotePop ${watcher ? "center" : ""}`}>
      <EmoteIcon kind={emote.kind} />
      {watcher && <span>👀 {emote.name}</span>}
    </div>
  );
}

// 테이블 화면 (연습판 · 온라인 공용)
export function HoldemTableView({
  table, meIndex, myHole, onAct, busy, deadline, title, subtitle, headerExtra, idleBar, notice, onReady, onClose, onBack,
  emotes = [], onEmote, emoteReadyIn = 0,
}: ViewProps) {
  // 감정표현: 앉은 사람은 그 자리 위에, 관전자는 테이블 가운데에
  const emoteAt = (member?: string) => (member ? emotes.filter((e) => e.member === member) : []);
  const watcherEmotes = emotes.filter((e) => !table.players.some((p) => !p.empty && p.member === e.member));
  useGameViewport();
  const [ranksOpen, setRanksOpen] = useState(false); // 휴대폰: 족보표 펼치기
  const n = table.players.length;
  const base = meIndex >= 0 ? meIndex : 0;
  const seated = meIndex >= 0;
  const posOf = (id: number) => (n === 4 ? SEAT_POS_4 : SEAT_POS_6)[(id - base + n) % n] ?? "top";

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
  const base0 = table.players[base];
  const myCards = seated && myHole && myHole.length === 2 ? myHole : null; // 앞면을 아는 내 카드
  const peekNeeded = !!myCards && base0.hole.length > 0;
  useEffect(() => {
    if (dealt < dealTotal) {
      const timer = window.setTimeout(() => setDealt((k) => k + 1), dealt === 0 ? 500 : 230);
      return () => window.clearTimeout(timer);
    }
    if (dealTotal > 0 && peekNeeded && myPeek < 2) {
      // 다 받은 뒤 잠깐 멈췄다가 첫 장, 조금 더 뜸 들여 두 번째 장
      const timer = window.setTimeout(() => setMyPeek((k) => k + 1), myPeek === 0 ? 800 : 1100);
      return () => window.clearTimeout(timer);
    }
  }, [dealt, dealTotal, myPeek, peekNeeded]);
  const dealtTo = (id: number) => dealOrder.slice(0, dealt).filter((x) => x === id).length;
  const dealDone = dealt >= dealTotal && (dealTotal === 0 || !peekNeeded || myPeek >= 2);
  useEffect(() => {
    if (boardShown >= table.board.length) return;
    // 플랍 첫 장 0.7초, 플랍 나머지 0.45초씩, 턴 · 리버는 1.4초 뜸
    const delay = boardShown === 0 ? 700 : boardShown < 3 ? 450 : 1400;
    const timer = window.setTimeout(() => setBoardShown((k) => k + 1), delay);
    return () => window.clearTimeout(timer);
  }, [boardShown, table.board.length]);
  const boardReady = boardShown >= table.board.length;
  const handOver = table.stage === "showdown";
  const contested = handOver && table.handNo > 0 && table.players.filter((p) => !p.out && !p.folded).length > 1;
  const showdownSeats = table.players.filter((p) => p.id !== meIndex && !p.out && !p.folded && p.hole.length > 0).map((p) => p.id);
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
      const timer = window.setTimeout(() => setRevealed((k) => k + 1), revealed === 0 ? 900 : 1000);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setRevealDone(true), 700);
    return () => window.clearTimeout(timer);
  }, [table.stage, contested, boardReady, revealed, showdownSeats.length]);
  const isRevealed = (id: number) => showdownSeats.indexOf(id) > -1 && showdownSeats.indexOf(id) < revealed;
  const wonAmount = (id: number) => table.winners.find((w) => w.id === id)?.amount ?? 0;
  // 결과(승자 · 칩)는 모두 공개된 뒤에만. 모두 폴드한 판은 바로
  const resultShown = handOver && (!contested || (boardReady && revealed >= showdownSeats.length && revealDone));
  // 공개가 끝나기 전에는 딴 칩을 빼고 보여준다 (결과를 미리 알 수 없게)
  const chipsShown = (id: number) => table.players[id].chips - (handOver && contested && !resultShown ? wonAmount(id) : 0);

  const ready = !handOver && boardReady && dealDone;
  useEffect(() => {
    onReady?.(ready);
  }, [ready, onReady]);

  const me = seated ? table.players[meIndex] : null;
  const myTurn = !!me && !!onAct && !handOver && table.turn === meIndex && ready;
  const pot = table.players.reduce((s, p) => s + p.total, 0);
  const info = myTurn ? legal(table) : null;
  const visibleBoard = table.board.slice(0, boardShown);
  const best = useMemo(
    () => (myCards && visibleBoard.length >= 3 ? bestHand([...myCards, ...visibleBoard]) : null),
    [myCards, visibleBoard.length], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 남은 시간 (차례인 자리에 표시)
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const secondsLeft = deadline && ready ? Math.max(0, Math.ceil((deadline - clock) / 1000)) : null;

  // 쿼터 · 하프 · 풀(팟): 콜 금액 + 팟의 1/4 · 1/2 · 전부만큼 올린다
  const sized = (frac: number) => {
    if (!info) return 0;
    const to = table.currentBet + Math.round(((pot + info.toCall) * frac) / 10) * 10;
    return Math.min(info.maxTo, Math.max(info.minRaiseTo, to));
  };
  const send = (action: Action) => onAct?.(action);
  const raise = (to: number) => send(to >= (info?.maxTo ?? 0) ? { type: "allin" } : { type: "raise", to });

  const order = table.players.filter((p) => !p.out).map((p) => p.id);
  const sbSeat = order.length === 2 ? table.dealer : order[(order.indexOf(table.dealer) + 1) % Math.max(1, order.length)];
  const bbSeat = order[(order.indexOf(sbSeat) + 1) % Math.max(1, order.length)];

  // 쇼다운 때 각자 어떤 메이드인지 (공개된 사람만)
  const cardsOf = (id: number) => (id === meIndex && myCards ? myCards : table.players[id].hole);
  const madeOf = (id: number) => {
    const p = table.players[id];
    const cards = cardsOf(id);
    if (!handOver || !contested || p.folded || p.out || cards.length < 2 || cards[0].r === 0 || table.board.length < 5) return "";
    if (id !== meIndex && !isRevealed(id) && !resultShown) return "";
    return HAND_NAME[bestHand([...cards, ...table.board]).score[0]];
  };
  // 결과 때 빛나는 카드: 이긴 사람의 족보 5장만 (폴드한 사람 · 진 사람 카드는 빛나지 않게)
  const winCards = resultShown && contested && table.board.length >= 5
    ? table.winners.flatMap((w) => {
        const cards = cardsOf(w.id);
        return cards.length === 2 && cards[0].r > 0 ? bestHand([...cards, ...table.board]).cards : [];
      })
    : [];
  const inWin = (c: Card) => winCards.some((b) => b.r === c.r && b.s === c.s);
  const lastLine = table.log.filter((line) => resultShown || !line.startsWith("🏆")).slice(-1)[0] ?? "";
  const roleOf = (id: number) =>
    table.handNo === 0 ? "" : table.dealer === id ? "D" : !handOver && sbSeat === id ? "SB" : !handOver && bbSeat === id ? "BB" : "";
  const isWin = (id: number) => resultShown && table.winners.some((w) => w.id === id);

  // ── 🔊 효과음 (오목 · 알까기와 같은 켜기/끄기 · 이 기기에 저장) ──
  const sound = useGameSound();
  const soundOn = useRef(sound.on);
  soundOn.current = sound.on;
  const sfx = (fn: () => void, delay = 0) => {
    if (!soundOn.current) return;
    if (delay) window.setTimeout(() => soundOn.current && fn(), delay);
    else fn();
  };
  useEffect(() => {
    if (dealt > 0 && dealt <= dealTotal) sfx(sndDeal);
  }, [dealt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (myPeek > 0) sfx(sndFlip);
  }, [myPeek]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (boardShown > 0) sfx(sndBoard);
  }, [boardShown]); // eslint-disable-line react-hooks/exhaustive-deps
  // 행동(체크 · 콜 · 레이즈 · 올인 · 폴드): 새로 생긴 기록 줄로 안다 (처음 열 때 · 새 판 첫 줄은 소리 없음)
  const seenLog = useRef<{ hand: number; lines: string[] } | null>(null);
  useEffect(() => {
    const prev = seenLog.current;
    seenLog.current = { hand: table.handNo, lines: table.log };
    if (!prev || prev.hand !== table.handNo) return;
    let overlap = 0;
    for (let m = Math.min(prev.lines.length, table.log.length); m > 0; m -= 1) {
      if (prev.lines.slice(prev.lines.length - m).join("\n") === table.log.slice(0, m).join("\n")) {
        overlap = m;
        break;
      }
    }
    table.log.slice(overlap).forEach((line, k) => sfx(() => sndForLog(line), k * 160));
  }, [table.log, table.handNo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (myTurn) sfx(sndMyTurn);
  }, [myTurn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (myTurn && secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 5) sfx(sndHurry);
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  const suspense = handOver && !revealDone && contested && boardReady;
  useEffect(() => {
    if (suspense) sfx(sndShowdown);
  }, [suspense]); // eslint-disable-line react-hooks/exhaustive-deps
  // 결과: 팟이 승자에게 → 내가 이겼으면 승리, 끝까지 가서 졌으면 패배 (열자마자 보이는 지난 결과는 소리 없음)
  const mountedResult = useRef(resultShown ? table.handNo : -1);
  useEffect(() => {
    if (!resultShown || table.handNo === 0 || mountedResult.current === table.handNo || table.winners.length === 0) return;
    sfx(sndPot);
    if (seated && me && !me.out) {
      if (isWin(meIndex)) sfx(sndWin, 450);
      else if (contested && !me.folded) sfx(sndLose, 450);
    }
  }, [resultShown, table.handNo]); // eslint-disable-line react-hooks/exhaustive-deps

  // 버튼 위: 얼마를 거는지 (+) / 폴드하면 얼마를 잃는지 (−)
  const cost = (amount: number, lose = false) => (
    <em className={`hdCost ${lose ? "lose" : ""}`}>{amount === 0 ? "0" : `${lose ? "−" : "+"}${fmt(amount)}`}</em>
  );
  const raiseDisabled = !info || info.minRaiseTo >= info.maxTo;

  const bottom = table.players[base];
  const bottomWin = isWin(base);
  const bottomCards = cardsOf(base);

  return (
    <div className="meetingModalBackdrop gameBackdrop" role="presentation">
      <section className="meetingModal gameModal hdModal" role="dialog" aria-modal="true" aria-label="텍사스 홀덤">
        <header className="hdTop">
          {onBack && <button className="hdIconBtn" onClick={onBack} aria-label="뒤로">‹</button>}
          <div className="hdTitle">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          {headerExtra}
          <button className="hdIconBtn hdSound" onClick={sound.toggle} aria-label={sound.on ? "소리 끄기" : "소리 켜기"} title={sound.on ? "소리 끄기" : "소리 켜기"}>
            {sound.on ? "🔊" : "🔇"}
          </button>
          <button className="hdRanksBtn" onClick={() => setRanksOpen((v) => !v)} aria-expanded={ranksOpen}>족보</button>
          <button className="hdIconBtn" onClick={onClose} aria-label="닫기">×</button>
        </header>

        <div className="hdBody">
        <div className="hdMain">
        <div className={`hdFelt seats${n}`}>
          <div className="hdRail">
            {/* 가운데: 팟 · 공용 카드 */}
            <div className="hdCenter">
              {watcherEmotes.map((e) => <EmotePop key={e.key} emote={e} watcher />)}
              <div className="hdPot"><span>POT</span><b>{fmt(pot)}</b></div>
              <div className="hdPotArea">
                {!resultShown && <ChipPile amount={pot - table.players.reduce((sum, q) => sum + q.bet, 0)} className="pot" />}
                <div className="hdCommunity">
                  {Array.from({ length: 5 }, (_, i) => (
                    <CardView
                      key={`${table.handNo}-${i}-${i < boardShown}`}
                      card={i < boardShown ? table.board[i] : undefined}
                      slow={i >= 3}
                      lit={i < boardShown && inWin(table.board[i])}
                    />
                  ))}
                </div>
              </div>
              <div className="hdCenterNote">
                {handOver && !revealDone && contested && boardReady ? (
                  <span className="hdSuspense">SHOWDOWN</span>
                ) : resultShown && table.winners.length > 0 ? (
                  <span className="hdWinner">
                    {table.winners.map((w) => `${shortName(w.name ?? table.players[w.id].name)} +${fmt(w.amount)} · ${w.hand}`).join("  /  ")}
                  </span>
                ) : null}
              </div>
            </div>

            {/* 다른 자리 */}
            {table.players.map((p) => {
              if (p.id === base) return null;
              const pos = posOf(p.id);
              if (p.empty) {
                return (
                  <div key={p.id} className={`hdSeat ${pos} emptySeat`}>
                    <div className="hdPill empty"><span className="hdPillText"><span>빈자리</span></span></div>
                  </div>
                );
              }
              const win = isWin(p.id);
              const lost = resultShown && contested && !win && !p.folded && !p.out;
              const made = madeOf(p.id);
              const status = p.out ? (p.chips > 0 ? "대기" : "탈락") : p.folded ? "폴드" : p.allIn ? "올인" : p.leaving ? "자리 비움" : "";
              const role = roleOf(p.id);
              const turn = table.turn === p.id && !handOver && dealDone;
              return (
                <div key={p.id} className={`hdSeat ${pos} ${turn ? "turn" : ""} ${p.folded || p.out ? "folded" : ""} ${win ? "win" : ""} ${lost ? "lost" : ""}`}>
                  {emoteAt(p.member).map((e) => <EmotePop key={e.key} emote={e} />)}
                  <div className="hdTags">
                    {win && <span className="hdWinTag">👑 WIN +{fmt(wonAmount(p.id))}</span>}
                    {made && <span className={`hdMade ${win ? "win" : ""}`}>{made}</span>}
                  </div>
                  <div className={`hdSeatCards ${isRevealed(p.id) ? "open" : ""}`}>
                    {p.hole.slice(0, handOver ? 2 : dealtTo(p.id)).map((c, k) => (
                      <span key={`${table.handNo}-${k}`} className="hdDealIn from-center">
                        <CardView key={`${k}-${isRevealed(p.id)}`} card={c} hidden={!isRevealed(p.id) || c.r === 0} size="sm" lit={isRevealed(p.id) && inWin(c)} />
                      </span>
                    ))}
                  </div>
                  <div className="hdPill">
                    <span className="hdAvatar">{shortName(p.name).slice(0, 1)}</span>
                    <span className="hdPillText">
                      <span>{shortName(p.name)}</span>
                      <b>{fmt(chipsShown(p.id))}</b>
                    </span>
                    {role && <span className={`hdRole ${role.toLowerCase()}`}>{role}</span>}
                    {status && <span className={`hdStatus ${status === "올인" ? "allin" : ""}`}>{status}</span>}
                    {turn && secondsLeft !== null && <span className={`hdClock ${secondsLeft <= 5 ? "hurry" : ""}`}>{secondsLeft}</span>}
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

            {/* 아래 자리 베팅 (테이블 안쪽 아래) */}
            {bottom.bet > 0 && (
              <div className="hdBet mine">
                <ChipPile amount={bottom.bet} className="bet" />
                <span>{fmt(bottom.bet)}</span>
              </div>
            )}
          </div>

          {/* 아래 자리: 나 (관전이면 0번 자리) */}
          {bottom.empty ? (
            <div className="hdMe">
              <div className="hdPill me empty"><span className="hdPillText"><span>빈자리</span></span></div>
            </div>
          ) : (
            <div className={`hdMe ${table.turn === base && !handOver && dealDone ? "turn" : ""} ${bottomWin ? "win" : ""} ${resultShown && contested && !bottomWin && !bottom.folded && !bottom.out ? "lost" : ""}`}>
              {emoteAt(bottom.member).map((e) => <EmotePop key={e.key} emote={e} />)}
              <div className="hdTags me">
                {bottomWin && <span className="hdWinTag">👑 WIN +{fmt(wonAmount(base))}</span>}
                {madeOf(base) && resultShown && <span className={`hdMade ${bottomWin ? "win" : ""}`}>{madeOf(base)}</span>}
              </div>
              <div className="hdMyCards">
                {bottomCards.slice(0, handOver ? 2 : dealtTo(base)).map((c, i) => {
                  const known = c.r > 0 && (base === meIndex ? true : handOver && contested);
                  const open = known && (base !== meIndex || myPeek > i || handOver);
                  return (
                    <span key={`${table.handNo}-${i}`} className="hdDealIn mine">
                      <span className="hdFan">
                        <span className={`hdFlipCard ${open ? "open" : ""}`}>
                          <CardView card={c} size="lg" hidden />
                          {known && <span className="hdFlipFront"><CardView card={c} size="lg" lit={inWin(c)} /></span>}
                        </span>
                      </span>
                    </span>
                  );
                })}
              </div>
              <div className="hdPill me">
                <span className="hdAvatar">{shortName(bottom.name).slice(0, 1)}</span>
                <span className="hdPillText">
                  <span>{best && base === meIndex ? HAND_NAME[best.score[0]] : shortName(bottom.name)}</span>
                  <b>{fmt(chipsShown(base))}</b>
                </span>
                {roleOf(base) && <span className={`hdRole ${roleOf(base).toLowerCase()}`}>{roleOf(base)}</span>}
                {table.turn === base && !handOver && dealDone && secondsLeft !== null && (
                  <span className={`hdClock ${secondsLeft <= 5 ? "hurry" : ""}`}>{secondsLeft}</span>
                )}
                {(bottom.leaving || (bottom.out && bottom.chips > 0)) && (
                  <span className="hdStatus">{bottom.leaving ? "자리 비움" : "다음 판부터"}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 행동 버튼: 위에 거는 금액(+) · 폴드면 잃는 금액(−) */}
        <div className="hdBar">
          {myTurn && info && me ? (
            <>
              <button className="fold" disabled={busy} onClick={() => send({ type: "fold" })}>
                {cost(me.total, true)}폴드
              </button>
              <button className="call" disabled={busy} onClick={() => send({ type: info.canCheck ? "check" : "call" })}>
                {cost(info.canCheck ? 0 : Math.min(info.toCall, me.chips))}{info.canCheck ? "체크" : "콜"}
              </button>
              <button disabled={busy || raiseDisabled} onClick={() => raise(sized(0.25))}>
                {cost(raiseDisabled ? 0 : sized(0.25) - me.bet)}쿼터
              </button>
              <button disabled={busy || raiseDisabled} onClick={() => raise(sized(0.5))}>
                {cost(raiseDisabled ? 0 : sized(0.5) - me.bet)}하프
              </button>
              <button disabled={busy || raiseDisabled} onClick={() => raise(sized(1))}>
                {cost(raiseDisabled ? 0 : sized(1) - me.bet)}풀
              </button>
              <button className="allin" disabled={busy} onClick={() => send({ type: "allin" })}>
                {cost(me.chips)}올인
              </button>
            </>
          ) : (
            idleBar?.({ handOver, resultShown }) ?? (
              <span className="hdWait">
                {handOver
                  ? resultShown
                    ? "다음 판 준비 중"
                    : "카드를 공개하는 중"
                  : !dealDone
                    ? dealt < dealTotal ? "카드를 나눠 주는 중" : "내 카드 확인 중"
                    : !boardReady
                      ? "카드를 까는 중"
                      : table.turn >= 0
                        ? `${shortName(table.players[table.turn].name)} 생각 중`
                        : ""}
                <i className="hdDots" aria-hidden="true" />
              </span>
            )
          )}
        </div>
        {notice}
        <p className="hdLastLine" aria-live="polite">{lastLine}</p>
        {onEmote && (
          <div className="omokEmoteBar hdEmoteBar" role="group" aria-label="감정표현">
            {EMOTES.map((item) => (
              <button
                key={item.kind}
                className="omokEmoteButton"
                disabled={emoteReadyIn > 0}
                aria-label={item.label}
                title={item.label}
                onClick={() => onEmote(item.kind)}
              >
                <EmoteIcon kind={item.kind} />
              </button>
            ))}
            {emoteReadyIn > 0 && <em className="omokEmoteWait">{Math.ceil(emoteReadyIn / 1000)}</em>}
          </div>
        )}
        </div>
        <div className={`hdRanksWrap ${ranksOpen ? "open" : ""}`}>
          <HandRanks current={best?.score[0]} onClose={() => setRanksOpen(false)} />
        </div>
        </div>
      </section>
    </div>
  );
}

// 🤖 연습판: 나 + 봇 3명 (연습용 칩 · 점수 · 티켓과 무관)
export default function HoldemGame({ onClose, onBack, myName }: { onClose: () => void; onBack?: () => void; myName: string }) {
  const [table, setTable] = useState<Table>(() => newTable(myName));
  const [ready, setReady] = useState(false);

  // 봇 차례면 잠깐 생각한 뒤 행동
  useEffect(() => {
    if (!ready || table.turn < 0 || !table.players[table.turn].bot) return;
    const timer = window.setTimeout(() => setTable((t) => (t.turn >= 0 && t.players[t.turn].bot ? act(t, botAction(t)) : t)), 750);
    return () => window.clearTimeout(timer);
  }, [table, ready]);

  const me = table.players[0];
  const alive = table.players.filter((p) => p.chips > 0).length;
  const gameOver = me.chips <= 0 || alive < 2;

  return (
    <HoldemTableView
      table={table}
      meIndex={0}
      myHole={me.hole}
      onAct={(action) => setTable((t) => act(t, action))}
      title="텍사스 홀덤 · 연습"
      subtitle={`블라인드 ${table.sb}/${table.bb}${table.handNo ? ` · ${table.handNo}번째 판` : ""} · 연습 칩 (점수 없음)`}
      onReady={setReady}
      onClose={onClose}
      onBack={onBack}
      idleBar={({ handOver, resultShown }) =>
        !handOver || !resultShown ? null : table.handNo > 0 && gameOver ? (
          <button className="next" onClick={() => setTable(startHand(newTable(myName)))}>
            {me.chips > 0 ? "모두 이겼어요 · 처음부터 다시" : "칩을 다 잃었어요 · 처음부터 다시"}
          </button>
        ) : (
          <button className="next" onClick={() => setTable((t) => startHand(t))}>{table.handNo === 0 ? "게임 시작" : "다음 판"}</button>
        )
      }
    />
  );
}
