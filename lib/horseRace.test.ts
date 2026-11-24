import assert from "node:assert/strict";
import test from "node:test";
import { calculateFreePredictionReward, createRacePlan, newRaceSeed, RACE_DURATION_MS } from "./horseRace";

test("same seed generates the same race", () => {
  const seed = "a".repeat(64);
  assert.deepEqual(createRacePlan(seed), createRacePlan(seed));
  assert.notDeepEqual(createRacePlan(seed).horses, createRacePlan("b".repeat(64)).horses);
});

test("six horses finish with unique ranks and monotonic progress", () => {
  for (let i = 0; i < 30; i += 1) {
    const plan = createRacePlan(newRaceSeed());
    assert.deepEqual(plan.horses.map((horse) => horse.rank).sort(), [1, 2, 3, 4, 5, 6]);
    assert.equal(plan.frames.at(-1)?.elapsedMs, RACE_DURATION_MS);
    assert.deepEqual(plan.frames.at(-1)?.positions, [1, 1, 1, 1, 1, 1]);
    for (let j = 1; j < plan.frames.length; j += 1) {
      for (let horse = 0; horse < 6; horse += 1) {
        assert.ok(plan.frames[j].positions[horse] >= plan.frames[j - 1].positions[horse]);
      }
    }
  }
});

test("fixed free-prediction rewards", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(calculateFreePredictionReward), [100, 50, 20, 0, 0, 0]);
});

test("seed validation", () => {
  assert.throws(() => createRacePlan("untrusted-seed"));
});
