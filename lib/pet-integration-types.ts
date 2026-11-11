export type PetIntegrationAction = {
  code: string;
  name: string;
  cooldownSeconds: number;
  available: boolean;
  availableAt: string | null;
  remainingSeconds: number;
};

export type PetIntegrationSummary = {
  ok: boolean;
  linked: boolean;
  externalMemberId?: string;
  externalNickname?: string;
  linkedAt?: string;
  meetingNickname?: string;
  profile?: {
    id: string;
    nickname: string;
  } | null;
  hasPet: boolean;
  balance?: number;
  pet: {
    id: string;
    name: string;
    level: number;
    exp: number;
    hunger: number;
    happiness: number;
    energy: number;
    affection: number;
    bornAt: string | null;
    species: {
      code: string;
      name: string;
    } | null;
    publicCode: string | null;
  } | null;
  actions?: PetIntegrationAction[];
  serverTime?: string;
  error?: string;
};
