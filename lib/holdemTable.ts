// 홀덤 온라인 테이블 진행 (서버 전용 · 순수 함수: DB 는 api/holdem 이 다룬다)
import { act, BUY_IN, legal, showdownOpen, startHand, type Action, type Player, type Table } from "./holdem";

export const TURN_SECONDS = 25;   // 한 사람 생각 시간
export const DEAL_SECONDS = 6;    // 새 판: 카드 나눠 주는 연출 시간만큼 더
export const STREET_SECONDS = 2;  // 플랍 · 턴 · 리버 까는 연출
export const GRACE_MS = 1500;     // 통신 지연 여유
export const MAX_STRIKES = 2;     // 연속 시간 초과 → 이번 판 뒤 자동으로 일어남
export const IDLE_MINUTES = 15;   // 혼자 남은 대기 테이블은 이 시간이 지나면 정리 (칩 반환)
export const SEAT_ACTIVE = ["escrow", "seated"];
export const REBUY_WAIT_MS = 12 * 1000;         // 봇이 충전을 처리하는 동안 다음 판을 이만큼까지 기다린다
export const PASS_RENEW_BEFORE_MS = 60 * 1000;  // 이용권이 1분 남으면 봇에게 연장(티켓 1장) 요청
export const PASS_RENEW_WAIT_MS = 30 * 1000;    // 끝난 뒤 이만큼 기다려도 연장이 안 되면 그 판 뒤 일어남

export type TableStatus = "waiting" | "playing" | "closed";
export type SeatRow = {
  id: string;
  table_id: string;
  member_id: string;
  name: string;
  status: string;
  buy_in: number;
  escrow_state: string;
  rebuy_state?: string;   // 충전: none | requested | locking | locked | failed
  rebuy_count?: number;   // 봇이 처리한 충전 횟수
  last_rebuy?: number;    // 마지막 충전 칩
  pass_until?: string | null; // 🎫 이용권 끝 시각 (없으면 옛 자리: 시간 제한 없음)
  renew_state?: string;       // 연장: none | requested | locking | failed
};

// 봇이 아직 충전을 처리 중인 자리 (그동안은 정산하지 않는다 — 차감한 점수가 사라지지 않게)
const rebuyPending = (seats: SeatRow[], p: Player) =>
  seats.some((s) => s.id === p.seatId && (s.rebuy_state === "requested" || s.rebuy_state === "locking"));
export type Ctx = {
  t: Table;
  status: TableStatus;
  turnDeadline: number | null;
  nextHandAt: number | null;
  updatedAt: number;
  seatUpdates: Map<string, Record<string, unknown>>;
};

const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (n: number) => n.toLocaleString("ko-KR");

const snap = (t: Table) => ({ hand: t.handNo, stage: t.stage, turn: t.turn, board: t.board.length });

// 행동 · 판 변화 뒤: 다음 사람 마감 시각, 판이 끝났으면 다음 판 시각
function afterChange(ctx: Ctx, before: ReturnType<typeof snap>, now: number) {
  const t = ctx.t;
  if (t.stage === "showdown") {
    ctx.turnDeadline = null;
    if (before.stage !== "showdown" || before.hand !== t.handNo) {
      const newCards = t.board.length - (before.hand === t.handNo ? before.board : 0);
      const shown = t.players.filter((p) => !p.out && !p.folded).length;
      // 화면이 카드를 한 장씩 까고, 한 명씩 공개한 뒤 결과를 보여 줄 시간
      ctx.nextHandAt = now + (showdownOpen(t) ? 5000 + shown * 1000 + newCards * 1100 : 3500 + newCards * 1100);
    }
    return;
  }
  if (t.turn !== before.turn || t.stage !== before.stage || t.handNo !== before.hand) {
    const extra = t.handNo !== before.hand ? DEAL_SECONDS : t.stage !== before.stage ? STREET_SECONDS + (t.board.length - before.board > 1 ? 1 : 0) : 0;
    ctx.turnDeadline = now + (TURN_SECONDS + extra) * 1000;
  }
}

export function apply(ctx: Ctx, action: Action, now: number) {
  const before = snap(ctx.t);
  ctx.t = act(ctx.t, action);
  afterChange(ctx, before, now);
}

// 일어남: 남은 칩을 기록하고 자리를 비운다 (이번 판에 낸 금액 total 은 팟 계산용으로 남겨 둔다)
function cashOut(ctx: Ctx, p: Player, now: number) {
  p.chips += p.pendingChips ?? 0;
  if (p.seatId) {
    ctx.seatUpdates.set(p.seatId, { status: "left", cash_out: p.chips, hands: p.hands ?? 0, left_at: iso(now) });
    ctx.t.leftSeats = [...(ctx.t.leftSeats ?? []), p.seatId].slice(-60);
  }
  ctx.t.log.push(`🚪 ${p.name} 일어남 · 칩 ${fmt(p.chips)}`);
  Object.assign(p, {
    name: "", chips: 0, hole: [], out: true, folded: true, allIn: false, empty: true,
    seatId: undefined, member: undefined, leaving: false, strikes: 0, hands: 0,
    standAfter: false, rebuys: 0, pendingChips: 0, rebuyQueued: false,
  });
}

// 판을 앞으로 진행: 새로 앉은 사람 · 시간 초과 · 일어난 사람 · 다음 판
export function step(ctx: Ctx, seats: SeatRow[], now: number) {
  // 1) 봇이 차감을 끝낸 자리 앉히기 (진행 중인 판에는 다음 판부터)
  for (const seat of seats) {
    if (seat.status !== "seated" || ctx.t.players.some((p) => p.seatId === seat.id) || (ctx.t.leftSeats ?? []).includes(seat.id)) continue;
    const slot = ctx.t.players.find((p) => p.empty && (ctx.t.stage === "showdown" || p.total === 0));
    if (!slot) {
      // 자리가 없으면 받은 그대로 돌려준다
      ctx.seatUpdates.set(seat.id, { status: "left", cash_out: seat.buy_in, hands: 0, left_at: iso(now) });
      ctx.t.leftSeats = [...(ctx.t.leftSeats ?? []), seat.id].slice(-60);
      continue;
    }
    Object.assign(slot, {
      name: seat.name, bot: false, chips: seat.buy_in, hole: [], bet: 0, total: 0,
      folded: true, allIn: false, acted: false, out: true, empty: false,
      seatId: seat.id, member: seat.member_id, leaving: false, strikes: 0, hands: 0,
      standAfter: false, rebuys: seat.rebuy_count ?? 0, pendingChips: 0,
    });
    ctx.t.log.push(`💺 ${seat.name} 착석 · 칩 ${fmt(seat.buy_in)}`);
    if (ctx.status === "closed") ctx.status = "waiting";
  }

  // 1-2) 충전: 봇이 점수를 차감했으면 칩을 준다 (판에 참여 중이면 판이 끝난 뒤)
  for (const seat of seats) {
    const p = ctx.t.players.find((q) => q.seatId === seat.id && !q.empty);
    if (!p || (seat.rebuy_count ?? 0) <= (p.rebuys ?? 0)) continue;
    p.rebuys = seat.rebuy_count ?? 0;
    p.pendingChips = (p.pendingChips ?? 0) + (seat.last_rebuy ?? 0);
    ctx.t.log.push(`💎 ${p.name} 충전 +${fmt(seat.last_rebuy ?? 0)}`);
  }
  for (const p of ctx.t.players) {
    if (!p.empty && p.pendingChips && (ctx.t.stage === "showdown" || p.out || p.folded)) {
      p.chips += p.pendingChips;
      p.pendingChips = 0;
    }
  }

  // 1-2-2) 충전 예약: 이 판의 칩이 정해진 뒤에야 점수를 뺀다 (이겨서 1,000개가 넘으면 충전하지 않는다)
  for (const p of ctx.t.players) {
    if (p.empty || !p.rebuyQueued || !(ctx.t.stage === "showdown" || p.out || p.folded)) continue;
    p.rebuyQueued = false;
    const seat = seats.find((s) => s.id === p.seatId && s.status === "seated");
    const want = BUY_IN - p.chips - (p.pendingChips ?? 0);
    if (!seat || p.leaving || p.standAfter || rebuyPending(seats, p)) continue;
    if (want <= 0) {
      ctx.t.log.push(`💎 ${p.name} 칩이 ${fmt(BUY_IN)}개 이상이라 충전하지 않았어요`);
      continue;
    }
    const fields = { rebuy_state: "requested", rebuy_want: want, rebuy_note: null };
    ctx.seatUpdates.set(seat.id, { ...ctx.seatUpdates.get(seat.id), ...fields });
    seat.rebuy_state = "requested"; // 아래 단계에서 이 자리를 충전 중으로 본다
  }

  // 1-3) 🎫 이용권(티켓 1장 = 1시간): 1분 남으면 연장 요청, 끝났는데 연장이 안 되면 이번 판 뒤 일어남
  for (const seat of seats) {
    const p = ctx.t.players.find((q) => q.seatId === seat.id && !q.empty);
    if (!p || seat.status !== "seated" || !seat.pass_until) continue;
    const until = new Date(seat.pass_until).getTime();
    const renew = seat.renew_state ?? "none";
    if (renew === "none" && now >= until - PASS_RENEW_BEFORE_MS && !p.leaving && !p.standAfter) {
      ctx.seatUpdates.set(seat.id, { ...ctx.seatUpdates.get(seat.id), renew_state: "requested" });
    }
    const expired = now >= until && (renew === "failed" || now >= until + PASS_RENEW_WAIT_MS);
    if (expired && !p.standAfter && !p.leaving) {
      p.standAfter = true;
      ctx.t.log.push(`🎫 ${p.name} 이용 시간 끝 → 이번 판이 끝나면 일어납니다`);
    }
  }

  // 2) 차례인 사람이 시간 초과 · 일어남 · 빈자리 → 자동 (체크 가능하면 체크, 아니면 폴드)
  for (let guard = 0; guard < 20 && ctx.t.stage !== "showdown" && ctx.t.turn >= 0; guard += 1) {
    const p = ctx.t.players[ctx.t.turn];
    const timedOut = ctx.turnDeadline !== null && now > ctx.turnDeadline + GRACE_MS;
    if (!p.leaving && !p.empty && !timedOut) break;
    if (timedOut && !p.leaving && !p.empty) {
      p.strikes = (p.strikes ?? 0) + 1;
      ctx.t.log.push(`⏰ ${p.name} 시간 초과`);
      if (p.strikes >= MAX_STRIKES) {
        p.leaving = true;
        ctx.t.log.push(`💤 ${p.name} 자리 비움 → 이번 판이 끝나면 일어납니다`);
      }
    }
    apply(ctx, legal(ctx.t).canCheck && !p.leaving && !p.empty ? { type: "check" } : { type: "fold" }, now);
  }

  // 3) 혼자 오래 기다린 테이블은 정리
  if (ctx.status === "waiting" && now - ctx.updatedAt > IDLE_MINUTES * 60 * 1000) {
    for (const p of ctx.t.players) if (!p.empty) p.leaving = true;
  }

  // 4) 진행 중인 판에서 이미 빠진(폴드) 사람이 일어나면 바로 정산
  if (ctx.t.stage !== "showdown") {
    for (const p of ctx.t.players) if (!p.empty && p.leaving && (p.folded || p.out) && !rebuyPending(seats, p)) cashOut(ctx, p, now);
  }

  // 4-2) 판이 끝난 뒤 '일어나기' 한 사람은 결과를 기다리지 않고 바로 정산.
  //      모두 나갔으면 바로 닫는다 (누가 화면을 켜 두지 않아도 방이 남지 않게)
  if (ctx.t.stage === "showdown") {
    for (const p of ctx.t.players) if (!p.empty && p.leaving && !rebuyPending(seats, p)) cashOut(ctx, p, now);
    if (ctx.t.players.every((p) => p.empty) && !seats.some((s) => s.status === "escrow")) {
      ctx.status = "closed";
      ctx.nextHandAt = null;
      ctx.turnDeadline = null;
      return;
    }
  }

  // 5) 판이 끝났고 결과를 보여 줄 시간이 지났으면: 일어날 사람 · 칩 없는 사람 정리 → 다음 판
  if (ctx.t.stage === "showdown" && (ctx.nextHandAt === null || now >= ctx.nextHandAt)) {
    // 충전 처리 중이면 잠깐 기다린다 (새 판이 먼저 시작되면 칩이 또 판 뒤로 밀린다)
    const rebuying = ctx.t.players.some((p) => !p.empty && rebuyPending(seats, p));
    if (rebuying && ctx.nextHandAt !== null && now < ctx.nextHandAt + REBUY_WAIT_MS) return;
    // 나가기 예약 · 일어남 · 칩 없음 (단, 충전 처리 중이면 기다린다)
    for (const p of ctx.t.players) {
      if (!p.empty && (p.leaving || p.standAfter || p.chips <= 0) && !rebuyPending(seats, p)) cashOut(ctx, p, now);
    }
    const ready = ctx.t.players.filter((p) => !p.empty && p.chips > 0);
    if (ready.length >= 2) {
      const before = snap(ctx.t);
      ctx.t = startHand(ctx.t);
      for (const p of ctx.t.players) if (!p.out) p.hands = (p.hands ?? 0) + 1;
      ctx.status = "playing";
      ctx.nextHandAt = null;
      afterChange(ctx, before, now);
    } else {
      const pending = seats.some((s) => s.status === "escrow");
      ctx.status = ready.length === 0 && !pending ? "closed" : "waiting";
      ctx.nextHandAt = null;
      ctx.turnDeadline = null;
    }
  }
}

