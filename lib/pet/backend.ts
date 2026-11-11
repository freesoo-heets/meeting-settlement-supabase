import type { PetIntegrationSummary } from "../pet-integration-types";

export type PetBackendMode = "bridge" | "local";

export type MeetingPetIdentity = {
  profileId: string;
  memberId: string;
  nickname: string;
};

export type PetBackend = {
  getSummary(identity: MeetingPetIdentity): Promise<PetIntegrationSummary>;
};

/**
 * During migration, Bridge remains the safe default.
 * Local mode will only be enabled after target schema + data verification.
 */
export function getPetBackendMode(): PetBackendMode {
  return process.env.PET_BACKEND_MODE === "local" ? "local" : "bridge";
}
