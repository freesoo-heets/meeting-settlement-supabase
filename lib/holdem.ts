// 텍사스 홀덤 규칙 (관리자 테스트용 · 화면에서만 돌아간다)
// 카드 · 족보 계산 · 사이드팟 · 간단한 봇

export type Suit = "s" | "h" | "d" | "c";
export type Card = { r: number; s: Suit }; // r: 2~14 (14 = A)

export const SUIT_ICON: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const RANK_TEXT: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A", 10: "10" };
export const rankText = (r: number) => RANK_TEXT[r] ?? String(r);

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of ["s", "h", "d", "c"] as Suit[]) for (let r = 2; r <= 14; r += 1) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ── 족보 ──
export const HAND_NAME = ["하이카드", "원페어", "투페어", "트리플", "스트레이트", "플러시", "풀하우스", "포카드", "스트레이트 플러시"];

// 5장 점수: [족보, 비교용 숫자들...]
function score5(cards: Card[]): number[] {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 14 && rs[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map((g) => g[0]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, ...order];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...order];
  if (flush) return [5, ...rs];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, ...order];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...order];
  if (groups[0][1] === 2) return [1, ...order];
  return [0, ...rs];
}

export function compareScore(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// 7장(또는 5~6장) 중 가장 좋은 5장
export function bestHand(cards: Card[]): { score: number[]; cards: Card[] } {
  let best: { score: number[]; cards: Card[] } | null = null;
  const n = cards.length;
  const pick = (start: number, chosen: Card[]) => {
    if (chosen.length === 5) {
      const score = score5(chosen);
      if (!best || compareScore(score, best.score) > 0) best = { score, cards: [...chosen] };
      return;
    }
    for (let i = start; i < n; i += 1) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best ?? { score: [0], cards: [] };
}

// ── 판 상태 ──
export type Player = {
  id: number;
  name: string;
  bot: boolean;
  chips: number;
  hole: Card[];
  bet: number;        // 이번 라운드에 낸 금액
  total: number;      // 이번 판에 낸 총액 (사이드팟 계산용)
  folded: boolean;
  allIn: boolean;
  acted: boolean;     // 마지막 레이즈 이후 행동했는지
  out: boolean;       // 칩이 없어 빠짐
  // ── 온라인 테이블용 ──
  seatId?: string;    // holdem_seats.id
  member?: string;    // members.id
  empty?: boolean;    // 빈자리
  leaving?: boolean;  // 이번 판 끝나면 일어남 (차례가 오면 자동 폴드)
  strikes?: number;   // 연속 시간 초과
  hands?: number;     // 앉은 뒤 참여한 판 수
  standAfter?: boolean;   // 나가기 예약: 이번 판을 끝까지 하고 일어남
  rebuys?: number;        // 반영한 충전 횟수 (holdem_seats.rebuy_count 와 비교)
  pendingChips?: number;  // 충전했지만 판이 끝나야 들어오는 칩
  rebuyQueued?: boolean;  // 판 도중 누른 충전 예약 (판이 끝난 뒤 칩이 모자라면 그만큼만 봇에게 요청)
};

export type Stage = "preflop" | "flop" | "turn" | "river" | "showdown";

export type Table = {
  players: Player[];
  deck: Card[];
  board: Card[];
  stage: Stage;
  dealer: number;
  turn: number;
  currentBet: number;
  minRaise: number;
  sb: number;
  bb: number;
  log: string[];
  handNo: number;
  winners: Array<{ id: number; amount: number; hand: string; name?: string }>;
  leftSeats?: string[]; // 온라인: 이미 정산(일어남)한 자리 — 다시 앉히지 않게
};

export const START_CHIPS = 1000;

export function newTable(myName: string): Table {
  const names = [myName || "나", "🤖 영식", "🤖 순자", "🤖 광수"];
  return {
    players: names.map((name, i) => ({
      id: i, name, bot: i !== 0, chips: START_CHIPS, hole: [], bet: 0, total: 0,
      folded: false, allIn: false, acted: false, out: false,
    })),
    deck: [], board: [], stage: "showdown", dealer: 3, turn: 0, currentBet: 0, minRaise: 20,
    sb: 10, bb: 20, log: [], handNo: 0, winners: [],
  };
}

const live = (t: Table) => t.players.filter((p) => !p.out);
const nextSeat = (t: Table, from: number, ok: (p: Player) => boolean) => {
  for (let k = 1; k <= t.players.length; k += 1) {
    const i = (from + k) % t.players.length;
    if (ok(t.players[i])) return i;
  }
  return -1;
};
const canAct = (p: Player) => !p.out && !p.folded && !p.allIn;

function put(t: Table, p: Player, amount: number) {
  const pay = Math.min(amount, p.chips);
  p.chips -= pay;
  p.bet += pay;
  p.total += pay;
  if (p.chips === 0) p.allIn = true;
  return pay;
}

export function startHand(prev: Table): Table {
  const t: Table = structuredClone(prev);
  for (const p of t.players) {
    p.out = p.chips <= 0;
    Object.assign(p, { hole: [], bet: 0, total: 0, folded: p.out, allIn: false, acted: false });
  }
  if (live(t).length < 2) return t;
  t.handNo += 1;
  t.deck = newDeck();
  t.board = [];
  t.winners = [];
  t.stage = "preflop";
  t.dealer = nextSeat(t, t.dealer, (p) => !p.out);
  const headsUp = live(t).length === 2;
  const sbSeat = headsUp ? t.dealer : nextSeat(t, t.dealer, (p) => !p.out);
  const bbSeat = nextSeat(t, sbSeat, (p) => !p.out);
  put(t, t.players[sbSeat], t.sb);
  put(t, t.players[bbSeat], t.bb);
  t.currentBet = t.bb;
  t.minRaise = t.bb;
  for (let k = 0; k < 2; k += 1) for (const p of t.players) if (!p.out) p.hole.push(t.deck.pop() as Card);
  t.log = [`── ${t.handNo}번째 판 ── 딜러 ${t.players[t.dealer].name} · 블라인드 ${t.sb}/${t.bb}`];
  t.turn = nextSeat(t, bbSeat, canAct);
  if (t.turn < 0) return runOut(t);
  return t;
}

export type Action = { type: "fold" | "check" | "call" | "raise" | "allin"; to?: number };

export function legal(t: Table) {
  const p = t.players[t.turn];
  const toCall = Math.max(0, t.currentBet - p.bet);
  return {
    toCall,
    canCheck: toCall === 0,
    minRaiseTo: Math.min(p.bet + p.chips, t.currentBet + t.minRaise),
    maxTo: p.bet + p.chips,
  };
}

export function act(prev: Table, action: Action): Table {
  const t: Table = structuredClone(prev);
  const p = t.players[t.turn];
  const { toCall } = legal(t);
  const say = (s: string) => t.log.push(`${p.name}: ${s}`);
  if (action.type === "fold") {
    p.folded = true;
    say("폴드");
  } else if (action.type === "check" || (action.type === "call" && toCall === 0)) {
    say("체크");
  } else if (action.type === "call") {
    const paid = put(t, p, toCall);
    say(p.allIn ? `콜 ${paid} (올인)` : `콜 ${paid}`);
  } else {
    const target = action.type === "allin" ? p.bet + p.chips : Math.min(p.bet + p.chips, Math.max(action.to ?? 0, t.currentBet + t.minRaise));
    const raiseBy = target - t.currentBet;
    put(t, p, target - p.bet);
    if (target > t.currentBet) {
      if (raiseBy >= t.minRaise) t.minRaise = raiseBy;
      t.currentBet = target;
      for (const q of t.players) if (q !== p && canAct(q)) q.acted = false;
      say(p.allIn ? `올인 ${target}` : `레이즈 ${target}`);
    } else {
      say(p.allIn ? `콜 (올인)` : "콜");
    }
  }
  p.acted = true;
  return advance(t);
}

function advance(t: Table): Table {
  const notFolded = t.players.filter((p) => !p.out && !p.folded);
  if (notFolded.length === 1) return finish(t, true);
  const waiting = t.players.filter((p) => canAct(p) && (!p.acted || p.bet < t.currentBet));
  if (waiting.length > 0) {
    t.turn = nextSeat(t, t.turn, (p) => canAct(p) && (!p.acted || p.bet < t.currentBet));
    return t;
  }
  // 라운드 끝 → 다음 카드
  for (const p of t.players) Object.assign(p, { bet: 0, acted: false });
  t.currentBet = 0;
  t.minRaise = t.bb;
  if (t.players.filter(canAct).length < 2) return runOut(t);
  return nextStreet(t);
}

function nextStreet(t: Table): Table {
  if (t.stage === "preflop") {
    t.board.push(t.deck.pop() as Card, t.deck.pop() as Card, t.deck.pop() as Card);
    t.stage = "flop";
  } else if (t.stage === "flop") {
    t.board.push(t.deck.pop() as Card);
    t.stage = "turn";
  } else if (t.stage === "turn") {
    t.board.push(t.deck.pop() as Card);
    t.stage = "river";
  } else return finish(t, false);
  t.log.push(`── ${({ flop: "플랍", turn: "턴", river: "리버" } as Record<string, string>)[t.stage]} ──`);
  t.turn = nextSeat(t, t.dealer, canAct);
  return t;
}

// 더 행동할 사람이 없으면 남은 카드를 모두 깔고 결과
function runOut(t: Table): Table {
  while (t.board.length < 5) t.board.push(t.deck.pop() as Card);
  return finish(t, false);
}

function finish(t: Table, everyoneFolded: boolean): Table {
  t.stage = "showdown";
  t.turn = -1;
  const contenders = t.players.filter((p) => !p.out && !p.folded);
  const winnings = new Map<number, number>();
  const handOf = new Map<number, { score: number[]; name: string }>();
  for (const p of contenders) {
    const best = bestHand([...p.hole, ...t.board]);
    handOf.set(p.id, { score: best.score, name: HAND_NAME[best.score[0]] });
  }
  if (everyoneFolded) {
    const pot = t.players.reduce((s, p) => s + p.total, 0);
    winnings.set(contenders[0].id, pot);
  } else {
    // 사이드팟: 낸 금액 단계별로 나눈다
    const levels = [...new Set(t.players.filter((p) => p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
    let prevLevel = 0;
    for (const level of levels) {
      const potPart = t.players.reduce((s, p) => s + Math.max(0, Math.min(p.total, level) - prevLevel), 0);
      const eligible = contenders.filter((p) => p.total >= level);
      prevLevel = level;
      if (!potPart || eligible.length === 0) continue;
      let top: Player[] = [];
      for (const p of eligible) {
        const c = top.length ? compareScore(handOf.get(p.id)!.score, handOf.get(top[0].id)!.score) : 1;
        if (c > 0) top = [p];
        else if (c === 0) top.push(p);
      }
      const share = Math.floor(potPart / top.length);
      top.forEach((p, i) => winnings.set(p.id, (winnings.get(p.id) ?? 0) + share + (i === 0 ? potPart - share * top.length : 0)));
    }
  }
  t.winners = [];
  for (const [id, amount] of winnings) {
    const p = t.players[id];
    p.chips += amount;
    const hand = everyoneFolded ? "모두 폴드" : handOf.get(id)?.name ?? "";
    t.winners.push({ id, amount, hand, name: p.name });
    t.log.push(`🏆 ${p.name} +${amount} (${hand})`);
  }
  for (const p of t.players) p.bet = 0;
  return t;
}

// ── 봇 ──
function strength(p: Player, board: Card[]): number {
  // 0~1 대략적인 손패 힘
  if (board.length === 0) {
    const [a, b] = p.hole;
    const hi = Math.max(a.r, b.r);
    const lo = Math.min(a.r, b.r);
    let v = (hi + lo) / 28;
    if (a.r === b.r) v = 0.55 + a.r / 30;
    if (a.s === b.s) v += 0.05;
    if (hi - lo === 1) v += 0.03;
    return Math.min(1, v);
  }
  const best = bestHand([...p.hole, ...board]).score;
  const base = [0.15, 0.4, 0.6, 0.72, 0.8, 0.85, 0.92, 0.97, 1][best[0]];
  return Math.min(1, base + (best[1] ?? 0) / 140);
}

export function botAction(t: Table): Action {
  const p = t.players[t.turn];
  const { toCall, canCheck, minRaiseTo, maxTo } = legal(t);
  const s = strength(p, t.board) + (Math.random() - 0.5) * 0.15;
  const pot = t.players.reduce((sum, q) => sum + q.total, 0);
  const priceRatio = toCall / Math.max(1, pot + toCall);
  if (s > 0.85 && Math.random() < 0.6) {
    const to = Math.min(maxTo, Math.max(minRaiseTo, t.currentBet + Math.round(pot * 0.6)));
    return to >= maxTo ? { type: "allin" } : { type: "raise", to };
  }
  if (s > 0.6 && Math.random() < 0.25 && minRaiseTo < maxTo) return { type: "raise", to: minRaiseTo };
  if (canCheck) return { type: "check" };
  if (s > priceRatio + 0.25 || (s > 0.45 && toCall <= t.bb * 2)) return { type: "call" };
  return { type: "fold" };
}

export const cardText = (c: Card) => `${SUIT_ICON[c.s]}${rankText(c.r)}`;

// ── 온라인 테이블 ──
export const ONLINE_SEATS = 6;
export const BUY_IN = 1000;

export function emptyTable(seats = ONLINE_SEATS): Table {
  return {
    players: Array.from({ length: seats }, (_, i) => ({
      id: i, name: "", bot: false, chips: 0, hole: [], bet: 0, total: 0,
      folded: true, allIn: false, acted: false, out: true, empty: true,
    })),
    deck: [], board: [], stage: "showdown", dealer: seats - 1, turn: -1, currentBet: 0, minRaise: 20,
    sb: 10, bb: 20, log: [], handNo: 0, winners: [],
  };
}

export const potOf = (t: Table) => t.players.reduce((s, p) => s + p.total, 0);

// 쇼다운에서 공개되는 사람: 모두 폴드가 아닌 판의 남은 사람
export function showdownOpen(t: Table) {
  return t.stage === "showdown" && t.handNo > 0 && t.players.filter((p) => !p.out && !p.folded).length > 1;
}

// 화면용: 덱을 빼고, 남의 손패는 뒷면(r: 0)으로. 쇼다운 공개분만 그대로
const BACK: Card = { r: 0, s: "s" };
export function publicView(t: Table): Table {
  const open = showdownOpen(t);
  return {
    ...t,
    deck: [],
    log: t.log.slice(-30),
    players: t.players.map((p) => ({
      ...p,
      hole: open && !p.folded && !p.out ? p.hole : p.hole.map(() => BACK),
    })),
  };
}
