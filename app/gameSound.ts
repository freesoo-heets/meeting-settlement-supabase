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

// 공통: 짧은 잡음 '딱' + 짧게 울리는 음 (샘플 페이지와 같은 방식)
type Hit = {
  click: { f: number; q: number; g: number; len: number };
  body: { f1: number; f2: number; dec: number; g: number };
  wood?: { f: number; q: number; dec: number; g: number };
  sub?: { f1: number; f2: number; dec: number; g: number };
  ring?: { f1: number; f2: number; dec: number; g: number };
  lp: number;
};

function hit(p: Hit, volume = 1, delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005 + delay;
  const out = ac.createGain();
  out.gain.value = 0.9 * volume;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.lp;
  out.connect(lp).connect(ac.destination);

  const len = Math.max(1, Math.floor(ac.sampleRate * p.click.len));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = p.click.f;
  bp.Q.value = p.click.q;
  const cg = ac.createGain();
  cg.gain.value = p.click.g;
  src.connect(bp).connect(cg).connect(out);
  src.start(t);

  if (p.wood) {
    const wl = Math.floor(ac.sampleRate * 0.02);
    const wb = ac.createBuffer(1, wl, ac.sampleRate);
    const wd = wb.getChannelData(0);
    for (let i = 0; i < wl; i += 1) wd[i] = (Math.random() * 2 - 1) * (1 - i / wl) ** 3;
    const ws = ac.createBufferSource();
    ws.buffer = wb;
    const wf = ac.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = p.wood.f;
    wf.Q.value = p.wood.q;
    const wg = ac.createGain();
    wg.gain.setValueAtTime(p.wood.g, t);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + p.wood.dec);
    ws.connect(wf).connect(wg).connect(out);
    ws.start(t);
  }

  for (const [tone, type] of [[p.body, "sine"], [p.sub, "sine"], [p.ring, "triangle"]] as const) {
    if (!tone) continue;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(tone.f1, t);
    o.frequency.exponentialRampToValueAtTime(tone.f2, t + tone.dec);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(tone.g, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + tone.dec + 0.02);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + tone.dec + 0.05);
  }
}

// 🏁 오목 착수: 샘플 35번 '플라스틱 돌'
export function playStone() {
  hit({ click: { f: 3600, q: 1.6, g: 1.2, len: 0.003 }, body: { f1: 1500, f2: 1300, dec: 0.03, g: 0.25 }, lp: 8000 });
}

// 🥏 알까기 효과음 (샘플 페이지에서 고른 조합: 당기기 P11 · 튕김 F9 · 충돌 C6 · 떨어짐 D24 · W2 · L3 · T4)

// F9 '팅' — 고무줄 튕기는 느낌
export function playFlick() {
  hit({
    click: { f: 2200, q: 1, g: 0.5, len: 0.003 },
    body: { f1: 700, f2: 520, dec: 0.09, g: 0.3 },
    ring: { f1: 1400, f2: 1300, dec: 0.08, g: 0.08 },
    lp: 7000,
  });
}

// C6 '탕' — 울림이 조금 남는 금속성 (세게 부딪힐수록 크게)
export function playClack(power: number) {
  const v = Math.min(1, Math.max(0.15, power / 450));
  hit(
    {
      click: { f: 3500, q: 1.2, g: 1, len: 0.003 },
      body: { f1: 1800, f2: 1750, dec: 0.1, g: 0.15 },
      ring: { f1: 2700, f2: 2650, dec: 0.2, g: 0.08 },
      lp: 10000,
    },
    v,
  );
}

// P11 '활시위 끼익' — 당기는 세기가 4% 오를 때마다 '끽' (세게 당길수록 높고 크게)
const PULL_STEP = 4;
let pullLast = -1;
export function playPull(power: number) {
  const step = Math.floor((power * 100) / PULL_STEP);
  if (step > pullLast && step > 0) {
    const f = 300 + 400 * power;
    hit({ click: { f: 1600, q: 2, g: 0.5, len: 0.004 }, body: { f1: f, f2: (f * 290) / 300, dec: 0.02, g: 0.08 }, lp: 3500 }, 0.5 + power * 0.5);
  }
  pullLast = step;
}
export function resetPull() {
  pullLast = -1;
}

// 음 이어 붙이기 (샘플 페이지와 같은 방식: 세모파 · 0.2 크기 · 음 길이의 90% 간격, 0Hz 는 쉼표)
function melody(notes: Array<[number, number]>) {
  const ac = audio();
  if (!ac) return;
  let t = ac.currentTime + 0.01;
  for (const [freq, len] of notes) {
    if (freq > 0) {
      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.02);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    t += len * 0.9;
  }
}

// D24 '빠빰' — 판 밖으로 떨어짐
export const playFall = () => melody([[294, 0.1], [220, 0.3]]);

// W2 팡파레 · L3 띠로리 · T4 삑삑
export const playAlkWin = () => melody([[523, 0.1], [523, 0.1], [523, 0.1], [659, 0.35], [587, 0.12], [784, 0.45]]);
export const playAlkLose = () => melody([[523, 0.12], [494, 0.12], [466, 0.12], [440, 0.4]]);
export const playAlkTick = () => melody([[1100, 0.06], [0, 0.05], [1100, 0.06]]);

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
