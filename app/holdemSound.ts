"use client";

// 🃏 홀덤 효과음 (파일 없이 브라우저에서 합성). 샘플 페이지에서 고른 번호:
// 나눠 주기 D6 · 내 카드 뒤집기 F2 · 공용 카드 B19 · 체크 K28 · 콜 C1 · 레이즈 R1 · 올인 A26 · 폴드 X17
// 내 차례 T17 · 시간 임박 H3 · 쇼다운 S24 · 팟 P18 · 승리 W17 · 패배 L18
import { audio } from "./gameSound";

const VOLUME = 0.8;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const r = Math.random;
const note = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function start() {
  const ac = audio();
  if (!ac) return null;
  const out = ac.createGain();
  out.gain.value = VOLUME;
  out.connect(ac.destination);
  return { ac, out, t: ac.currentTime + 0.02 };
}
type Ctx = NonNullable<ReturnType<typeof start>>;

function noise(c: Ctx, t: number, dur: number, o: { f?: number; f2?: number; q?: number; g?: number; attack?: number; type?: BiquadFilterType } = {}) {
  const { ac, out } = c;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f ?? 3000, t);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.g ?? 0.5, t + (o.attack ?? 0.002));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.03);
}

function tone(c: Ctx, t: number, dur: number, o: { f?: number; f2?: number; g?: number; attack?: number; type?: OscillatorType } = {}) {
  const { ac, out } = c;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f ?? 440, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.g ?? 0.3, t + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

type Chip = { f: number; q: number; len: number; ring: number; r1: number; r2: number };
function chip(c: Ctx, t: number, k: Chip, g = 0.5) {
  noise(c, t, 0.025 + k.len, { f: k.f, q: k.q, g });
  tone(c, t, 0.05 + k.ring, { f: k.r1, g: g * 0.22, type: "triangle" });
  tone(c, t, 0.04 + k.ring * 0.7, { f: k.r2, g: g * 0.14 });
}
function swish(c: Ctx, t: number, dur: number, f1: number, f2: number, g = 0.35) {
  noise(c, t, dur, { f: f1, f2, q: 0.9, g, attack: dur * 0.3 });
}

// D6 카드 나눠 주기: 휙
export function sndDeal() {
  const c = start();
  if (c) swish(c, c.t, 0.07, lerp(7000, 4500, r()), lerp(1600, 900, r()), 0.35);
}
// F2 내 카드 뒤집기: 휘릭
export function sndFlip() {
  const c = start();
  if (c) swish(c, c.t, 0.1, lerp(1200, 900, r()), lerp(6500, 4000, r()), 0.3);
}
// B19 공용 카드: 휙 + 탁
export function sndBoard() {
  const c = start();
  if (!c) return;
  swish(c, c.t, 0.06, 5000, 1500, 0.25);
  noise(c, c.t + 0.055, 0.04, { type: "lowpass", f: 900, q: 1, g: 0.55 });
}
// K28 체크: 펠트 툭툭
export function sndCheck() {
  const c = start();
  if (!c) return;
  for (let k = 0; k < 2; k += 1) noise(c, c.t + k * lerp(0.1, 0.15, r()), 0.05, { type: "lowpass", f: 527, q: 0.6, g: 0.85, attack: 0.004 });
}
// C1 콜: 칩 두 개
export function sndCall() {
  const c = start();
  if (!c) return;
  const k = { f: 4800, q: lerp(10, 5, r()), len: 0.01, ring: 0.02, r1: lerp(5200, 3600, r()), r2: lerp(6900, 4800, r()) };
  const gap = lerp(0.05, 0.085, r());
  for (let j = 0; j < 2; j += 1) chip(c, c.t + j * gap, k, 0.5 - j * 0.05);
}
// R1 레이즈: 칩 와르르
export function sndRaise() {
  const c = start();
  if (!c) return;
  const k = { f: 4600, q: lerp(9, 5, r()), len: 0.012, ring: 0.025, r1: lerp(5000, 3400, r()), r2: lerp(6600, 4500, r()) };
  for (let j = 0; j < 7; j += 1) chip(c, c.t + j * lerp(0.025, 0.045, r()), k, 0.45 - j * 0.03);
}
// A26 올인: 칩 산사태
export function sndAllin() {
  const c = start();
  if (!c) return;
  const k = { f: 3733, q: 6, len: 0.015, ring: 0.03, r1: lerp(4800, 3200, r()), r2: lerp(6400, 4300, r()) };
  const dur = 0.733;
  const n = 19;
  noise(c, c.t, dur, { f: 2500, f2: 1100, q: 0.6, g: 0.2, attack: 0.05 });
  for (let j = 0; j < n; j += 1) chip(c, c.t + j * (dur / n) + r() * 0.012, k, 0.38 * (1 - j / (n * 1.6)));
}
// X17 폴드: 휙 버림
export function sndFold() {
  const c = start();
  if (c) swish(c, c.t, 0.14, 4000, 900, 0.25);
}
// T17 내 차례: 띵동 2음
export function sndMyTurn() {
  const c = start();
  if (!c) return;
  tone(c, c.t, 0.25, { f: note(77), g: 0.25, type: "triangle" });
  tone(c, c.t + 0.14, 0.35, { f: note(81), g: 0.25, type: "triangle" });
}
// H3 시간 임박: 삐 짧게
export function sndHurry() {
  const c = start();
  if (c) tone(c, c.t, 0.05, { f: 1800, g: 0.15, type: "square" });
}
// S24 쇼다운: 팀파니 롤
export function sndShowdown() {
  const c = start();
  if (!c) return;
  for (let j = 0; j < 14; j += 1) tone(c, c.t + j * 0.055, 0.12, { f: 90, f2: 80, g: 0.15 + (0.5 * j) / 22 });
}
// P18 팟 가져오기: 와르르 길게
export function sndPot() {
  const c = start();
  if (!c) return;
  const k = { f: 2800, q: 7, len: 0.01, ring: 0.02, r1: lerp(5000, 3400, r()), r2: lerp(6600, 4500, r()) };
  for (let j = 0; j < 20; j += 1) chip(c, c.t + j * 0.05 + r() * 0.01, k, 0.4 - j * 0.015);
}
// W17 승리: 팡파르
export function sndWin() {
  const c = start();
  if (!c) return;
  [0, 4, 7].forEach((s, j) => tone(c, c.t + j * 0.11, 0.18, { f: note(67 + s), g: 0.2, type: "square" }));
  tone(c, c.t + 0.33, 0.55, { f: note(79), g: 0.22, type: "square" });
}
// L18 패배: 아쉬운 3음
export function sndLose() {
  const c = start();
  if (!c) return;
  [0, -1, -5].forEach((s, j) => tone(c, c.t + j * 0.22, j === 2 ? 0.7 : 0.25, { f: note(65 + s), g: 0.18 }));
}

// 로그 한 줄 → 행동 소리 ("이름: 콜 20", "이름: 올인 500" …)
export function sndForLog(line: string) {
  const i = line.lastIndexOf(": ");
  if (i < 0) return;
  const what = line.slice(i + 2);
  if (what.includes("올인")) sndAllin();
  else if (what.startsWith("레이즈")) sndRaise();
  else if (what.startsWith("콜")) sndCall();
  else if (what.startsWith("체크")) sndCheck();
  else if (what.startsWith("폴드")) sndFold();
}
