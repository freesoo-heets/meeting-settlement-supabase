import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, requireMemberId } from "../../../lib/gameServer";
import { computeRatings, type RatedGame } from "../../../lib/rating";

/**
 * 오목·알까기 레이팅 랭킹.
 *  GET /api/rating?kind=omok|alkkagi            → 누적 · 이번 달 랭킹
 *  GET /api/rating?kind=omok|alkkagi&game=<id>  → 그 대국의 레이팅 변동만
 * 테스트 대국 · 취소 · 판돈 잠금 실패는 빼고, 친선전은 넣는다.
 */

const TABLES = { omok: "omok_games", alkkagi: "alkkagi_games" } as const;

function monthStartKstIso() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 9 * 3600 * 1000;
  return new Date(start).toISOString();
}

async function loadGames(admin: ReturnType<typeof getServerAdmin>, table: string) {
  const games: RatedGame[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from(table)
      .select("id,host_member,guest_member,winner,finished_at,end_reason")
      .eq("status", "finished")
      .eq("is_test", false)
      .not("winner", "is", null)
      .not("guest_member", "is", null)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.end_reason === "cancel" || row.end_reason === "escrow_failed") continue;
      games.push(row as RatedGame);
    }
    if (!data || data.length < 1000) break;
  }
  return games;
}

export async function GET(request: Request) {
  const admin = getServerAdmin();
  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as keyof typeof TABLES;
  if (!TABLES[kind]) return fail("게임 종류가 올바르지 않습니다.");

  let games: RatedGame[];
  try {
    games = await loadGames(admin, TABLES[kind]);
  } catch (error) {
    return fail(`기록을 불러오지 못했습니다: ${(error as Error).message}`, 500);
  }

  const all = computeRatings(games);
  const gameId = url.searchParams.get("game");
  if (gameId) return NextResponse.json({ ok: true, change: all.changes[gameId] ?? null });

  const monthStart = monthStartKstIso();
  const month = computeRatings(games.filter((game) => game.finished_at >= monthStart));

  const ids = new Set([...all.rows.map((row) => row.memberId)]);
  const names: Record<string, string> = {};
  if (ids.size) {
    const { data } = await admin.from("members").select("id,name").in("id", [...ids]);
    for (const member of data ?? []) names[member.id as string] = member.name as string;
  }

  return NextResponse.json({
    ok: true,
    me: auth.memberId,
    names,
    all: all.rows,
    month: month.rows,
  });
}
