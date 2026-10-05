"use client";

import { useId } from "react";
import { BOARD_SIZE, type Board } from "../lib/omok";

// 오목 감정표현 (A안 스티커)
export const EMOTES = [
  { kind: "thumb", label: "엄지척" },
  { kind: "laugh", label: "웃음" },
  { kind: "cry", label: "눈물" },
  { kind: "angry", label: "화내기" },
  { kind: "question", label: "물음표" },
  { kind: "hurry", label: "재촉하기" },
] as const;

export type EmoteKind = (typeof EMOTES)[number]["kind"];
export const EMOTE_COOLDOWN_MS = 3000;
export const EMOTE_SHOW_MS = 2200;

export function isEmoteKind(value: unknown): value is EmoteKind {
  return EMOTES.some((emote) => emote.kind === value);
}

export function EmoteIcon({ kind }: { kind: EmoteKind }) {
  const id = useId().replace(/:/g, "");
  const face = `face${id}`;
  const angry = `angry${id}`;

  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={face} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffe27a" />
          <stop offset="1" stopColor="#f5b82e" />
        </radialGradient>
        <radialGradient id={angry} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ff9a7a" />
          <stop offset="1" stopColor="#e5452b" />
        </radialGradient>
      </defs>

      {kind === "thumb" && (
        <>
          <circle cx="50" cy="50" r="46" fill="#dbeafe" />
          <path
            d="M30 48h12l10-22c2-5 10-4 10 3l-2 15h14c5 0 8 4 7 8l-5 22c-1 4-4 6-8 6H42V48"
            fill="#fcd9a8"
            stroke="#7a4b1c"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <rect x="22" y="46" width="16" height="36" rx="3" fill="#2563eb" stroke="#1e3a8a" strokeWidth="3" />
          <path d="M62 60h12M62 70h11" stroke="#7a4b1c" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}

      {kind === "laugh" && (
        <>
          <circle cx="50" cy="50" r="46" fill={`url(#${face})`} stroke="#c98a12" strokeWidth="2" />
          <path d="M26 40q8-9 16 0M58 40q8-9 16 0" fill="none" stroke="#5b3a0a" strokeWidth="4" strokeLinecap="round" />
          <path d="M26 56h48q-2 24-24 24t-24-24z" fill="#7a1f1f" />
          <path d="M36 72q14 8 28 0q-4 7-14 7t-14-7z" fill="#f87171" />
          <path d="M28 57h44" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <circle cx="24" cy="54" r="6" fill="#fb923c" opacity=".45" />
          <circle cx="76" cy="54" r="6" fill="#fb923c" opacity=".45" />
        </>
      )}

      {kind === "cry" && (
        <>
          <circle cx="50" cy="50" r="46" fill={`url(#${face})`} stroke="#c98a12" strokeWidth="2" />
          <path d="M26 34l14 5M74 34l-14 5" stroke="#5b3a0a" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M28 46q7-6 14 0M58 46q7-6 14 0" fill="none" stroke="#5b3a0a" strokeWidth="4" strokeLinecap="round" />
          <path d="M30 50q-2 20 2 40h8q2-20 0-40z" fill="#60a5fa" opacity=".9" />
          <path d="M70 50q2 20-2 40h-8q-2-20 0-40z" fill="#60a5fa" opacity=".9" />
          <path d="M40 76q10-10 20 0" fill="none" stroke="#5b3a0a" strokeWidth="4" strokeLinecap="round" />
        </>
      )}

      {kind === "question" && (
        <>
          <circle cx="50" cy="52" r="44" fill={`url(#${face})`} stroke="#c98a12" strokeWidth="2" />
          {/* 갸우뚱한 눈썹 · 눈 · 입 */}
          <path d="M28 40q7-5 14-1M60 36q7-2 13 3" fill="none" stroke="#5b3a0a" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="36" cy="52" r="5" fill="#5b3a0a" />
          <circle cx="65" cy="50" r="5" fill="#5b3a0a" />
          <path d="M40 76q8-5 18-1" fill="none" stroke="#5b3a0a" strokeWidth="4" strokeLinecap="round" />
          {/* ??? */}
          <g fill="#7c3aed" stroke="#fff" strokeWidth="1.5" fontWeight="900" fontFamily="Arial, sans-serif">
            <text x="58" y="26" fontSize="24">?</text>
            <text x="72" y="20" fontSize="28">?</text>
            <text x="86" y="30" fontSize="22">?</text>
          </g>
        </>
      )}

      {kind === "hurry" && (
        <>
          {/* 초시계 */}
          <rect x="44" y="6" width="12" height="9" rx="2" fill="#475569" />
          <path d="M74 20l7-7" stroke="#475569" strokeWidth="5" strokeLinecap="round" />
          <circle cx="50" cy="56" r="40" fill="#fff" stroke="#ef4444" strokeWidth="6" />
          <path d="M50 56V30" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
          <path d="M50 56l16 10" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="56" r="4" fill="#0f172a" />
          {/* 움직임 선 */}
          <path d="M4 40h8M2 54h10M5 68h8" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" />
          {/* 빨리! */}
          <rect x="54" y="74" width="44" height="22" rx="11" fill="#ef4444" />
          <text x="76" y="90" fontSize="14" fontWeight="900" fill="#fff" textAnchor="middle" fontFamily="'Noto Sans KR', 'Malgun Gothic', sans-serif">빨리!</text>
        </>
      )}

      {kind === "angry" && (
        <>
          <circle cx="50" cy="52" r="44" fill={`url(#${angry})`} stroke="#a3231a" strokeWidth="2" />
          <path d="M24 36l18 8M76 36l-18 8" stroke="#3b0d0a" strokeWidth="5" strokeLinecap="round" />
          <circle cx="37" cy="52" r="5" fill="#3b0d0a" />
          <circle cx="63" cy="52" r="5" fill="#3b0d0a" />
          <path d="M36 78q14-12 28 0" fill="none" stroke="#3b0d0a" strokeWidth="5" strokeLinecap="round" />
          <path d="M76 14l6 6m0-6l-6 6M84 22l5 5m0-5l-5 5" stroke="#a3231a" strokeWidth="3" strokeLinecap="round" />
          <path d="M12 20q4-8 10-2q4-8 10 0" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// 판을 3×3 으로 나눈 가장자리 8칸 (가운데 칸은 제외: 대국이 주로 벌어지는 곳)
// col·row 는 0~2. 화면 위치는 판 너비의 % 로 쓴다.
export const EMOTE_SPOTS: Array<[number, number]> = [
  [0, 0], [1, 0], [2, 0],
  [0, 1], [2, 1],
  [0, 2], [1, 2], [2, 2],
];

// 돌이 가장 적은 가장자리 칸을 고른다. 같은 수면 그중 무작위.
export function pickEmoteSpot(board: Board): number {
  const size = BOARD_SIZE / 3; // 5칸씩
  const counts = EMOTE_SPOTS.map(([col, row]) => {
    let count = 0;
    for (let y = row * size; y < (row + 1) * size; y += 1) {
      for (let x = col * size; x < (col + 1) * size; x += 1) {
        if (board[y][x] !== 0) count += 1;
      }
    }
    return count;
  });
  const min = Math.min(...counts);
  const best = counts.map((count, index) => (count === min ? index : -1)).filter((index) => index >= 0);
  return best[Math.floor(Math.random() * best.length)];
}

export function spotStyle(spot: number) {
  const [col, row] = EMOTE_SPOTS[spot] ?? EMOTE_SPOTS[0];
  // 크기(판 너비의 16%)를 각 칸(33%) 가운데에 둔다
  return { left: `${col * 33 + 8.5}%`, top: `${row * 33 + 7}%` };
}

// 좌표 목록(판 대비 0~1)으로 돌이 가장 적은 가장자리 칸을 고른다 (알까기용)
export function pickEmoteSpotFromPoints(points: Array<[number, number]>): number {
  const counts = EMOTE_SPOTS.map(([col, row]) =>
    points.filter(([x, y]) => Math.min(2, Math.floor(x * 3)) === col && Math.min(2, Math.floor(y * 3)) === row).length,
  );
  const min = Math.min(...counts);
  const best = counts.map((count, index) => (count === min ? index : -1)).filter((index) => index >= 0);
  return best[Math.floor(Math.random() * best.length)];
}

// 판을 180도 돌려 보는 사람에게 맞는 칸
export function mirrorSpot(spot: number): number {
  const [col, row] = EMOTE_SPOTS[spot] ?? EMOTE_SPOTS[0];
  const index = EMOTE_SPOTS.findIndex(([c, r]) => c === 2 - col && r === 2 - row);
  return index >= 0 ? index : spot;
}
