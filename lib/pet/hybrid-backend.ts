import type {
  MeetingPetIdentity,
  PetBackend,
} from "./backend";
import type { PetIntegrationSummary } from "../pet-integration-types";
import { BridgePetBackend } from "./bridge-backend";
import { LocalPetBackend } from "./local-backend";

export class HybridPetBackend implements PetBackend {
  private readonly local = new LocalPetBackend();
  private readonly bridge = new BridgePetBackend();

  async getSummary(
    identity: MeetingPetIdentity
  ): Promise<PetIntegrationSummary> {
    try {
      return await this.local.getSummary(identity);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PET_LOCAL_UNKNOWN_ERROR";

      if (message !== "PET_LOCAL_PROFILE_NOT_MIGRATED") {
        console.error("[PET_HYBRID] local backend failed; falling back to bridge", error);
      }

      return this.bridge.getSummary(identity);
    }
  }
}
