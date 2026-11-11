import type {
  MeetingPetIdentity,
  PetBackend,
} from "./backend";
import type { PetIntegrationSummary } from "../pet-integration-types";

function getBridgeConfig() {
  const secret = process.env.MEETING_INTEGRATION_SECRET;
  const baseUrl = process.env.JJINCHIN_PET_URL;

  if (!secret || !baseUrl) {
    throw new Error("PET_BRIDGE_CONFIG_MISSING");
  }

  return {
    secret,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
}

export class BridgePetBackend implements PetBackend {
  async getSummary(
    identity: MeetingPetIdentity
  ): Promise<PetIntegrationSummary> {
    const config = getBridgeConfig();

    const endpoint =
      `${config.baseUrl}/api/integration/meeting/me` +
      `?externalMemberId=${encodeURIComponent(identity.memberId)}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.secret}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    const result = (await response.json().catch(() => null)) as
      | PetIntegrationSummary
      | null;

    if (!response.ok || !result) {
      const error = new Error(
        result?.error ?? `PET bridge failed (${response.status})`
      );
      Object.assign(error, { status: response.status });
      throw error;
    }

    return {
      ...result,
      meetingNickname: identity.nickname,
    };
  }
}
