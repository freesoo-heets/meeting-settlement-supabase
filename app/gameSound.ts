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

// 오목판에 돌을 '딱' 내려놓는 소리
//   ① 돌과 판이 부딪히는 아주 짧고 높은 마찰음  ② 단단한 돌의 맑은 울림  ③ 나무판의 낮은 울림
export function playStone() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 0.9;
  out.connect(ac.destination);

  // ① 딱 (6ms 잡음 · 높은 대역)
  const len = Math.floor(ac.sampleRate * 0.006);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const click = ac.createBufferSource();
  click.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = "bandpass";
  hp.frequency.value = 3800;
  hp.Q.value = 0.7;
  const cg = ac.createGain();
  cg.gain.value = 1.4;
  click.connect(hp).connect(cg).connect(out);
  click.start(t);

  // ② 돌의 맑은 울림 (짧게)
  const stone = ac.createOscillator();
  stone.type = "sine";
  stone.frequency.setValueAtTime(1650, t);
  stone.frequency.exponentialRampToValueAtTime(1250, t + 0.05);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(0.22, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  stone.connect(sg).connect(out);
  stone.start(t);
  stone.stop(t + 0.07);

  // ③ 나무판 울림 (낮고 조금 길게)
  const wood = ac.createOscillator();
  wood.type = "triangle";
  wood.frequency.setValueAtTime(420, t);
  wood.frequency.exponentialRampToValueAtTime(300, t + 0.09);
  const wg = ac.createGain();
  wg.gain.setValueAtTime(0.3, t);
  wg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  wood.connect(wg).connect(out);
  wood.start(t);
  wood.stop(t + 0.11);
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
