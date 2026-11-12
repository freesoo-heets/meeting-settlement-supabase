export const tarotOrigin = "https://tarot-bank.vercel.app";

function usageKey(userId: string) {
  return `jjinchin:tarot-portal:v1:${userId}`;
}

export function readTarotPortalUsage(userId: string): { visits: number; lastVisit: string | null } {
  try {
    const value = JSON.parse(localStorage.getItem(usageKey(userId)) ?? "null");
    if (Number.isSafeInteger(value?.visits) && value.visits >= 0 &&
        typeof value.lastVisit === "string" && Number.isFinite(Date.parse(value.lastVisit))) {
      return value;
    }
  } catch {
    // Storage can be disabled in the browser.
  }
  return { visits: 0, lastVisit: null };
}

export function recordTarotPortalUsage(userId: string) {
  try {
    const { visits } = readTarotPortalUsage(userId);
    localStorage.setItem(usageKey(userId), JSON.stringify({
      visits: visits + 1,
      lastVisit: new Date().toISOString(),
    }));
  } catch {
    // Reading remains available without browser storage.
  }
}
