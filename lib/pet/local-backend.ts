import type {
  MeetingPetIdentity,
  PetBackend,
} from "./backend";
import type { PetIntegrationSummary } from "../pet-integration-types";

/**
 * Local backend is intentionally disabled until:
 * 1. PET target schema exists in Meeting Supabase.
 * 2. profile/member mapping preflight passes.
 * 3. source/target counts and balances match.
 *
 * Keeping this explicit prevents accidental cutover while Tarot and Meeting
 * development continue on the same application.
 */
export class LocalPetBackend implements PetBackend {
  async getSummary(
    _identity: MeetingPetIdentity
  ): Promise<PetIntegrationSummary> {
    throw new Error("PET_LOCAL_BACKEND_NOT_READY");
  }
}
