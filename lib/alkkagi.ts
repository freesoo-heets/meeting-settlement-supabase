// 알까기 (장기알) 물리 엔진
// 서버(결과 확정)와 화면(애니메이션)이 같은 코드로 같은 결과를 계산한다.
// 고정된 시간 간격으로만 계산하므로 같은 입력이면 항상 같은 결과가 나온다.

export const CELL = 40;
export const MARGIN = 30;
export const BOARD_W = MARGIN * 2 + CELL * 8; // 380
export const BOARD_H = MARGIN * 2 + CELL * 9; // 420
export const TURN_SECONDS = 20;
export const MAX_STRIKES = 3; // 연속 시간 초과 3번이면 패배
export const MAX_SHOTS = 120; // 이 수를 넘기면 남은 알 수로 판정
export const VMAX = 650; // 최대 속도 (단위/초) — 900에서 낮춤

const DT = 1 / 60;
const FRICTION = 300; // 감속 (단위/초²) — 조금 더 빨리 멈추게
const RESTITUTION = 0.92;
const MAX_STEPS = 900;

export type Side = "cho" | "han";
export type Kind = "gung" | "cha" | "po" | "ma" | "sang" | "sa" | "jol";

export type Piece = {
  id: string;
  side: Side;
  kind: Kind;
  x: number;
  y: number;
  out: boolean;
};

export type Shot = { id: string; vx: number; vy: number };

// 알마다 낼 수 있는 최고 세기 (작은 사·졸은 약하게)
export const POWER: Record<Kind, number> = {
  gung: 1,
  cha: 1,
  po: 1,
  ma: 1,
  sang: 1,
  sa: 0.65,
  jol: 0.65,
};

export const RADIUS: Record<Kind, number> = {
  gung: 21,
  cha: 17,
  po: 17,
  ma: 17,
  sang: 17,
  sa: 13,
  jol: 13,
};

export const LABEL: Record<Side, Record<Kind, string>> = {
  cho: { gung: "楚", cha: "車", po: "包", ma: "馬", sang: "象", sa: "士", jol: "卒" },
  han: { gung: "漢", cha: "車", po: "包", ma: "馬", sang: "象", sa: "士", jol: "兵" },
};

function at(col: number, row: number) {
  return { x: MARGIN + col * CELL, y: MARGIN + row * CELL };
}

// 장기 첫 배치. 한(漢)이 위, 초(楚)가 아래.
export function initialPieces(): Piece[] {
  const pieces: Piece[] = [];
  const back: Array<[number, Kind]> = [
    [0, "cha"], [1, "ma"], [2, "sang"], [3, "sa"], [5, "sa"], [6, "sang"], [7, "ma"], [8, "cha"],
  ];
  const place = (side: Side, flip: (row: number) => number) => {
    let n = 0;
    const add = (kind: Kind, col: number, row: number) => {
      const { x, y } = at(col, flip(row));
      pieces.push({ id: `${side}${n++}`, side, kind, x, y, out: false });
    };
    back.forEach(([col, kind]) => add(kind, col, 0));
    add("gung", 4, 1);
    add("po", 1, 2);
    add("po", 7, 2);
    [0, 2, 4, 6, 8].forEach((col) => add("jol", col, 3));
  };
  place("han", (row) => row);
  place("cho", (row) => 9 - row);
  return pieces;
}

export function clampShot(vx: number, vy: number) {
  const speed = Math.hypot(vx, vy);
  if (!Number.isFinite(speed) || speed === 0) return { vx: 0, vy: 0 };
  if (speed <= VMAX) return { vx, vy };
  return { vx: (vx / speed) * VMAX, vy: (vy / speed) * VMAX };
}

type Body = Piece & { vx: number; vy: number; r: number; m: number };

// 한 번 튕긴 결과를 계산한다. onStep 이 있으면 매 순간 위치를 넘겨준다 (화면 재생용).
export function simulate(pieces: Piece[], shot: Shot, onStep?: (state: Piece[]) => void): Piece[] {
  const { vx, vy } = clampShot(shot.vx, shot.vy);
  const bodies: Body[] = pieces.map((piece) => {
    const r = RADIUS[piece.kind];
    // 무게는 부피 기준 (반지름³) → 궁은 졸보다 약 4배 무겁다
    return { ...piece, r, m: r * r * r, vx: 0, vy: 0 };
  });
  const shooter = bodies.find((body) => body.id === shot.id && !body.out);
  if (!shooter) return pieces.map((piece) => ({ ...piece }));
  // 알 종류별 최고 세기를 넘지 않게
  const cap = VMAX * POWER[shooter.kind];
  const speed = Math.hypot(vx, vy);
  const scale = speed > cap ? cap / speed : 1;
  shooter.vx = vx * scale;
  shooter.vy = vy * scale;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let moving = false;

    for (const b of bodies) {
      if (b.out) continue;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
    }

    // 충돌
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i];
      if (a.out) continue;
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j];
        if (b.out) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        // 겹친 만큼 무게 반비례로 밀어낸다
        const overlap = minDist - d;
        const ia = 1 / a.m;
        const ib = 1 / b.m;
        const share = overlap / (ia + ib);
        a.x -= nx * share * ia;
        a.y -= ny * share * ia;
        b.x += nx * share * ib;
        b.y += ny * share * ib;
        // 부딪힘
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const impulse = (-(1 + RESTITUTION) * vn) / (ia + ib);
          a.vx -= impulse * ia * nx;
          a.vy -= impulse * ia * ny;
          b.vx += impulse * ib * nx;
          b.vy += impulse * ib * ny;
        }
      }
    }

    // 마찰 · 판 밖
    for (const b of bodies) {
      if (b.out) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 0) {
        const next = Math.max(0, speed - FRICTION * DT);
        b.vx = (b.vx / speed) * next;
        b.vy = (b.vy / speed) * next;
      }
      if (b.x < 0 || b.x > BOARD_W || b.y < 0 || b.y > BOARD_H) {
        b.out = true;
        b.vx = 0;
        b.vy = 0;
      }
      if (Math.hypot(b.vx, b.vy) > 1) moving = true;
    }

    onStep?.(bodies.map(toPiece));
    if (!moving) break;
  }

  return bodies.map((b) => ({ ...toPiece(b), x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100 }));
}

function toPiece(b: Body): Piece {
  return { id: b.id, side: b.side, kind: b.kind, x: b.x, y: b.y, out: b.out };
}

export function alive(pieces: Piece[], side: Side) {
  return pieces.filter((piece) => piece.side === side && !piece.out).length;
}

// 튕긴 뒤 승패. null 이면 계속.
export function judge(pieces: Piece[], shooter: Side, shotNo: number): Side | "draw" | null {
  const other: Side = shooter === "cho" ? "han" : "cho";
  const mine = alive(pieces, shooter);
  const theirs = alive(pieces, other);
  if (mine === 0 && theirs === 0) return "draw";
  if (theirs === 0) return shooter;
  if (mine === 0) return other;
  if (shotNo >= MAX_SHOTS) {
    if (mine === theirs) return "draw";
    return mine > theirs ? shooter : other;
  }
  return null;
}
