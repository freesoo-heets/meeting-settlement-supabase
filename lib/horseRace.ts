import { createHash, randomBytes } from "node:crypto";

/** Server-only pure race engine. Do not send the seed to clients before finish. */
export const HORSE_COUNT = 6;
export const RACE_DURATION_MS = 27_000;
export const FRAME_MS = 250;
export const HORSES = ["번개", "폭주", "메타몽", "푸들이", "로켓", "행운"] as const;

export type HorseResult = {
  number: number;
  name: string;
  finishMs: number;
  rank: number;
};
export type RaceFrame = { elapsedMs: number; positions: number[] };
export type RacePlan = { horses: HorseResult[]; frames: RaceFrame[] };

/** Generate this secret only on the server when a race starts. */
export function newRaceSeed(): string {
  return randomBytes(32).toString("hex");
}

/** Deterministic, uniformly distributed 0..1 from secret seed + named slot. */
function unit(seed: string, slot: string): number {
  const hash = createHash("sha256").update(seed).update(":").update(slot).digest();
  return hash.readUIntBE(0, 6) / 0x1000000000000;
}

export function createRacePlan(seed: string): RacePlan {
  if (!/^[a-f0-9]{64}$/i.test(seed)) throw new Error("Invalid race seed");
  const horses = HORSES.map((name, i) => ({
    number: i + 1,
    name,
    // Distinct finishing times, all within 19–25 sec.
    finishMs: 19_000 + Math.floor(unit(seed, `time:${i}`) * 6_000) + i / 100,
    rank: 0,
  }));
  const order = [...horses].sort((a, b) => a.finishMs - b.finishMs);
  order.forEach((horse, index) => { horse.rank = index + 1; });

  const frames: RaceFrame[] = [];
  const last = Array<number>(HORSE_COUNT).fill(0);
  for (let ms = 0; ms <= RACE_DURATION_MS; ms += FRAME_MS) {
    const positions = horses.map((horse, index) => {
      const t = Math.min(1, ms / horse.finishMs);
      // Smooth mid-race speed variations. Noise vanishes at start/finish.
      const envelope = Math.sin(Math.PI * t);
      const variation = (
        Math.sin(t * Math.PI * 4 + unit(seed, `phase:${index}`) * Math.PI * 2) * 0.022 +
        Math.sin(t * Math.PI * 7 + unit(seed, `phase2:${index}`) * Math.PI * 2) * 0.009
      ) * envelope;
      const progress = ms >= horse.finishMs ? 1 : Math.max(0, Math.min(0.999, t + variation));
      last[index] = Math.max(last[index], progress);
      return Math.round(last[index] * 10_000) / 10_000;
    });
    frames.push({ elapsedMs: ms, positions });
  }
  return { horses: horses.sort((a, b) => a.number - b.number), frames };
}

export function calculateFreePredictionReward(rank: number): number {
  return rank === 1 ? 100 : rank === 2 ? 50 : rank === 3 ? 20 : 0;
}
