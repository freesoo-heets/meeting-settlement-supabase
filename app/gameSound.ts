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
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

// 🔊 / 🔇 상태 (기본: 켜짐)
export function useGameSound() {
  const [on, setOn] = useState(true);
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

// 바둑돌 놓는 '딱' 소리: 짧은 잡음 + 낮게 떨어지는 울림
export function playStone() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;

  const noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.04), ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = ac.createBufferSource();
  src.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2200;
  band.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.value = 0.9;
  src.connect(band).connect(ng).connect(ac.destination);
  src.start(t);

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.13);
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
