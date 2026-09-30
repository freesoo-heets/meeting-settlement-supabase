// 오목 (렌주룰) 판정
// - 흑: 정확히 5목이면 승리. 장목(6목 이상)·4-4·3-3 은 금수 (착수 불가)
//   단, 5목이 되는 수는 금수 여부와 관계없이 승리
// - 백: 5목 이상이면 승리, 금수 없음
// 서버(착수 검증)와 화면(금수 표시)이 같은 코드를 쓴다.

export const BOARD_SIZE = 15;
export const CENTER = 7;
export const TURN_SECONDS = 30;

export type Stone = 0 | 1 | 2; // 0 빈칸, 1 흑, 2 백
export type Board = Stone[][];
export type Move = [number, number]; // [x, y]

const DIRS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Stone>(BOARD_SIZE).fill(0));
}

// moves[0] 이 흑, 이후 번갈아 둔다
export function boardFromMoves(moves: Move[]): Board {
  const board = emptyBoard();
  moves.forEach(([x, y], index) => {
    board[y][x] = index % 2 === 0 ? 1 : 2;
  });
  return board;
}

function inside(x: number, y: number) {
  return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

// (x,y) 를 지나는 d 방향 연속 돌 개수
function runLength(board: Board, x: number, y: number, dx: number, dy: number, color: Stone) {
  let count = 1;
  for (const sign of [1, -1]) {
    let cx = x + dx * sign;
    let cy = y + dy * sign;
    while (inside(cx, cy) && board[cy][cx] === color) {
      count += 1;
      cx += dx * sign;
      cy += dy * sign;
    }
  }
  return count;
}

function isExactFive(board: Board, x: number, y: number) {
  return DIRS.some(([dx, dy]) => runLength(board, x, y, dx, dy, 1) === 5);
}

function isOverline(board: Board, x: number, y: number) {
  return DIRS.some(([dx, dy]) => runLength(board, x, y, dx, dy, 1) >= 6);
}

// (x,y) 흑돌이 d 방향으로 '정확히 5목'을 완성할 수 있는 빈칸들
function fiveCompletions(board: Board, x: number, y: number, dx: number, dy: number): Move[] {
  const points: Move[] = [];
  for (let step = -4; step <= 4; step += 1) {
    if (step === 0) continue;
    const qx = x + dx * step;
    const qy = y + dy * step;
    if (!inside(qx, qy) || board[qy][qx] !== 0) continue;
    board[qy][qx] = 1;
    // 새 돌과 원래 돌이 같은 연속 줄에 있어야 한다
    const len = runLength(board, x, y, dx, dy, 1);
    const connected = runLength(board, qx, qy, dx, dy, 1) === len;
    board[qy][qx] = 0;
    if (len === 5 && connected) points.push([qx, qy]);
  }
  return points;
}

// d 방향 4 의 개수 (열린 4 는 완성점이 두 개여도 하나로 센다)
function foursInDirection(board: Board, x: number, y: number, dx: number, dy: number) {
  const points = fiveCompletions(board, x, y, dx, dy);
  if (points.length === 2) {
    const [a, b] = points;
    const dist = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    if (dist === 5) return 1;
  }
  return points.length;
}

function isOpenFour(board: Board, x: number, y: number, dx: number, dy: number) {
  const points = fiveCompletions(board, x, y, dx, dy);
  if (points.length !== 2) return false;
  const [a, b] = points;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 5;
}

// d 방향이 '진짜 3' 인가: 한 수 더 두면 열린 4 가 되고, 그 수가 금수가 아니어야 한다
function isThreeInDirection(board: Board, x: number, y: number, dx: number, dy: number, depth: number) {
  for (let step = -4; step <= 4; step += 1) {
    if (step === 0) continue;
    const qx = x + dx * step;
    const qy = y + dy * step;
    if (!inside(qx, qy) || board[qy][qx] !== 0) continue;
    board[qy][qx] = 1;
    let ok = false;
    if (runLength(board, x, y, dx, dy, 1) === runLength(board, qx, qy, dx, dy, 1) && isOpenFour(board, x, y, dx, dy)) {
      ok = !isForbiddenPlaced(board, qx, qy, depth + 1);
    }
    board[qy][qx] = 0;
    if (ok) return true;
  }
  return false;
}

// 이미 놓인 흑돌 (x,y) 가 금수인가
function isForbiddenPlaced(board: Board, x: number, y: number, depth = 0): boolean {
  if (isExactFive(board, x, y)) return false;
  if (isOverline(board, x, y)) return true;
  if (depth > 3) return false;

  let fours = 0;
  let threes = 0;
  for (const [dx, dy] of DIRS) {
    const f = foursInDirection(board, x, y, dx, dy);
    if (f > 0) {
      fours += f;
    } else if (isThreeInDirection(board, x, y, dx, dy, depth)) {
      threes += 1;
    }
  }
  return fours >= 2 || threes >= 2;
}

// 흑이 (x,y) 에 두면 금수인가 (빈칸 기준)
export function isForbidden(board: Board, x: number, y: number): boolean {
  if (!inside(x, y) || board[y][x] !== 0) return false;
  board[y][x] = 1;
  const result = isForbiddenPlaced(board, x, y);
  board[y][x] = 0;
  return result;
}

export function forbiddenPoints(board: Board): Move[] {
  const points: Move[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x] === 0 && isForbidden(board, x, y)) points.push([x, y]);
    }
  }
  return points;
}

export type MoveCheck =
  | { ok: false; reason: string }
  | { ok: true; win: boolean; draw: boolean };

// 다음 수를 검사한다 (moves 는 지금까지의 수)
export function checkMove(moves: Move[], x: number, y: number): MoveCheck {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inside(x, y)) {
    return { ok: false, reason: "판 밖입니다." };
  }
  const board = boardFromMoves(moves);
  if (board[y][x] !== 0) return { ok: false, reason: "이미 돌이 있습니다." };

  const color: Stone = moves.length % 2 === 0 ? 1 : 2;
  board[y][x] = color;

  if (color === 1) {
    if (isExactFive(board, x, y)) return { ok: true, win: true, draw: false };
    if (isForbiddenPlaced(board, x, y)) return { ok: false, reason: "금수입니다. (흑 3-3 · 4-4 · 장목)" };
  } else if (DIRS.some(([dx, dy]) => runLength(board, x, y, dx, dy, 2) >= 5)) {
    return { ok: true, win: true, draw: false };
  }

  return { ok: true, win: false, draw: moves.length + 1 >= BOARD_SIZE * BOARD_SIZE };
}
