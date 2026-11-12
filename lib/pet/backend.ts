import type { PetIntegrationSummary } from "../pet-integration-types";

export type PetBackendMode = "bridge" | "local" | "hybrid";

export type MeetingPetIdentity = {
  profileId: string;
  memberId: string;
  nickname: string;
};

export type PetBackend = {
  getSummary(identity: MeetingPetIdentity): Promise<PetIntegrationSummary>;
};

/**
 * Hybrid is the safe migration default:
 * - migrated profiles use Meeting-local PET data first
 * - non-migrated profiles continue through the legacy bridge
 *
 * PET_BACKEND_MODE can still force bridge/local during rollback or verification.
 */
export function getPetBackendMode(): PetBackendMode {
  if (process.env.PET_BACKEND_MODE === "bridge") return "bridge";
  if (process.env.PET_BACKEND_MODE === "local") return "local";
  return "hybrid";
}
