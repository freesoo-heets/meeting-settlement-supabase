export function expRequiredForLevel(level: number) {
  return 50 + level * 25;
}

export function applyExperience(level: number, exp: number, earnedExp: number) {
  let nextLevel = level;
  let nextExp = exp + earnedExp;
  let levelsGained = 0;

  while (nextLevel < 50) {
    const required = expRequiredForLevel(nextLevel);
    if (nextExp < required) break;
    nextExp -= required;
    nextLevel += 1;
    levelsGained += 1;
  }

  if (nextLevel >= 50) {
    nextLevel = 50;
    nextExp = 0;
  }

  return { level: nextLevel, exp: nextExp, levelsGained };
}
