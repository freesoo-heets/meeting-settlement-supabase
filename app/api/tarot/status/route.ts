import { NextResponse } from "next/server";

export async function GET() {
  let status: "ready" | "degraded" | "unavailable" = "unavailable";

  try {
    const response = await fetch("https://tarot-bank.vercel.app/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const health = await response.json();
      if (health.service === "TAROT-Bank" && typeof health.ok === "boolean") {
        status = health.ok ? "ready" : "degraded";
      }
    }
  } catch {
    // The dashboard can still show the other services when Tarot is unavailable.
  }

  return NextResponse.json({ status }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
