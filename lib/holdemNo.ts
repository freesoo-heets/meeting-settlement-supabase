import type { SupabaseClient } from "@supabase/supabase-js";

// 홀덤 테이블 번호 = 그날(한국 시각) 몇 번째로 연 테이블인지 (2026-11-11 사용자 요청: '카티님의 테이블' 대신 '홀덤 1번 테이블')
// 표에 번호 칸이 없어서 만든 시각으로 센다. 한 번 정해진 번호는 바뀌지 않는다 (앞 테이블이 닫혀도 그대로).
// 봇(holdem_bridge.py)도 같은 방법으로 센다.

const KST_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;
const cache = new Map<string, number>();

type TableNumberRow = { id: string; created_at: string };
const pendingRanges = new WeakMap<SupabaseClient, Map<string, Promise<TableNumberRow[] | null>>>();

function readTableNumberRange(client: SupabaseClient, from: string, to: string) {
  let pending = pendingRanges.get(client);
  if (!pending) {
    pending = new Map();
    pendingRanges.set(client, pending);
  }

  const key = `${from}/${to}`;
  const existing = pending.get(key);
  if (existing) return existing;

  const requests = pending;
  const request = (async () => {
      const { data, error } = await client
        .from("holdem_tables")
        .select("id,created_at")
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: true })
        .limit(1000);
    return error ? null : data as TableNumberRow[] | null;
  })().finally(() => requests.delete(key));

  requests.set(key, request);
  return request;
}

/** 그 시각이 든 한국 날짜의 0시 (밀리초) */
function kstDayStartMs(iso: string): number {
  const t = Date.parse(iso) + KST_MS;
  return t - (((t % DAY_MS) + DAY_MS) % DAY_MS) - KST_MS;
}

/** 테이블 id → 번호. 못 읽은 것은 빠진다 (화면은 '홀덤 테이블' 로 보여 준다) */
export async function holdemTableNumbers(
  client: SupabaseClient,
  rows: Array<{ id: string; created_at?: string | null }>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const need = rows.filter((row) => {
    const hit = cache.get(row.id);
    if (hit) out[row.id] = hit;
    return !hit && row.created_at && !Number.isNaN(Date.parse(row.created_at));
  });
  if (need.length === 0) return out;
  const starts = need.map((row) => kstDayStartMs(row.created_at as string));
  const from = new Date(Math.min(...starts)).toISOString();
  const to = new Date(Math.max(...need.map((row) => Date.parse(row.created_at as string))) + 1000).toISOString();
  const data = await readTableNumberRange(client, from, to);
  if (!data) return out;
  const list = data.map((row) => ({
    id: row.id,
    day: kstDayStartMs(row.created_at),
  }));
  for (const row of need) {
    const index = list.findIndex((item) => item.id === row.id);
    if (index < 0) continue;
    const no = list.slice(0, index + 1).filter((item) => item.day === list[index].day).length;
    cache.set(row.id, no);
    out[row.id] = no;
  }
  return out;
}

/** '홀덤 1번 테이블' (번호를 못 읽었으면 '홀덤 테이블') */
export function holdemTableLabel(no?: number | null): string {
  return no ? `홀덤 ${no}번 테이블` : "홀덤 테이블";
}
