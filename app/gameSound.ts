"use client";

// 게임 효과음 (파일 없이 브라우저에서 바로 만든다). 켜고 끄기는 사용자마다 이 기기에 저장.
import { useEffect, useState } from "react";

const KEY = "gameSoundOn";
let ctx: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // 휴대폰은 화면을 한 번 누른 뒤에야 소리가 난다
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function readOn() {
  try {
    return window.localStorage.getItem(KEY) === "on";   // 기본은 꺼짐 (직접 켜야 소리가 난다)
  } catch {
    return false;
  }
}

// 🔊 / 🔇 상태 (기본: 꺼짐)
export function useGameSound() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readOn());
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // 저장이 안 돼도 이번 화면에서는 적용
    }
    if (next) playStone(); // 켰다는 걸 들려준다
  };
  return { on, toggle };
}

// 오목판에 돌을 '똑' 내려놓는 묵직한 소리 (두꺼운 나무 바둑판 느낌)
//   ① 돌이 닿는 순간의 짧은 '딱' (높은 소리는 줄임)  ② 판 몸통의 낮은 '똑' 울림  ③ 아래로 깔리는 둔한 울림
export function playStone() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 1;
  const soft = ac.createBiquadFilter();   // 너무 날카롭지 않게
  soft.type = "lowpass";
  soft.frequency.value = 3200;
  out.connect(soft).connect(ac.destination);

  // ① 닿는 순간 (4ms 잡음, 중간 높이)
  const len = Math.floor(ac.sampleRate * 0.004);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const click = ac.createBufferSource();
  click.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1900;
  bp.Q.value = 0.9;
  const cg = ac.createGain();
  cg.gain.value = 0.9;
  click.connect(bp).connect(cg).connect(out);
  click.start(t);

  // ② 판 몸통의 '똑' (낮고 단단하게, 빠르게 사라짐)
  const body = ac.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(310, t);
  body.frequency.exponentialRampToValueAtTime(190, t + 0.12);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.7, t + 0.003);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  body.connect(bg).connect(out);
  body.start(t);
  body.stop(t + 0.17);

  // ③ 둔한 저음 (묵직함)
  const sub = ac.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(140, t);
  sub.frequency.exponentialRampToValueAtTime(95, t + 0.1);
  const ub = ac.createGain();
  ub.gain.setValueAtTime(0.0001, t);
  ub.gain.exponentialRampToValueAtTime(0.45, t + 0.004);
  ub.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  sub.connect(ub).connect(out);
  sub.start(t);
  sub.stop(t + 0.14);

  // 나무의 짧은 잔향 (살짝)
  const ring = ac.createOscillator();
  ring.type = "triangle";
  ring.frequency.setValueAtTime(820, t);
  ring.frequency.exponentialRampToValueAtTime(640, t + 0.05);
  const rg = ac.createGain();
  rg.gain.setValueAtTime(0.08, t);
  rg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  ring.connect(rg).connect(out);
  ring.start(t);
  ring.stop(t + 0.07);
}

function tones(notes: Array<[number, number]>, volume = 0.18) {
  const ac = audio();
  if (!ac) return;
  let t = ac.currentTime;
  for (const [freq, len] of notes) {
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
    t += len * 0.85;
  }
}

export const playWin = () => tones([[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.3]]);
export const playLose = () => tones([[392, 0.2], [330, 0.2], [262, 0.35]], 0.14);
export const playTick = () => tones([[880, 0.06]], 0.08);
