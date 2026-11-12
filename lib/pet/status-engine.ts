export type PetStatusInput = {
  hunger: number;
  happiness: number;
  energy: number;
  last_status_calculated_at: string;
};

export function calculateCurrentStatus(pet: PetStatusInput, now = new Date()) {
  const last = new Date(pet.last_status_calculated_at);
  const elapsedMs = Math.max(0, now.getTime() - last.getTime());
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  const hunger = clamp(Number(pet.hunger) - elapsedHours * 2);
  const happiness = clamp(Number(pet.happiness) - elapsedHours * 0.5);
  const energy = clamp(Number(pet.energy));

  return {
    hunger: round2(hunger),
    happiness: round2(happiness),
    energy: round2(energy),
    calculatedAt: now.toISOString(),
    elapsedHours,
  };
}

export function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function growthMultiplier(hunger: number, happiness: number) {
  if (hunger >= 80 && happiness >= 80) return 1.2;
  if (hunger >= 50 && happiness >= 50) return 1;
  if (hunger < 20 || happiness < 20) return 0.5;
  return 1;
}
