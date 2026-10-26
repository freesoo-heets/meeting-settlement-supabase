import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import {
  FRIENDLY_TICKET_ERROR,
  fail,
  loadFriendlyPlayer,
  loadPlayer,
  requestInvite,
  requireMemberId,
  type Admin,
} from "../../../lib/gameServer";
import { BUY_IN, emptyTable, legal, publicView, type Action, type Table } from "../../../lib/holdem";
import { SEAT_ACTIVE, apply, step, type Ctx, type SeatRow, type TableStatus } from "../../../lib/holdemTable";

/*
 * 텍사스 홀덤 API (모든 쓰기는 여기서만 한다)
 *
 * 점수·티켓은 사이트가 직접 건드리지 않는다.
 *  · 자리 신청 → holdem_seats(escrow·requested) → 봇이 1000점 · 티켓 1장 차감 후 seated 로 바꾼다
 *  · 여기서 seated 자리를 테이블에 앉히고 판을 진행한다 (덱 · 손패는 holdem_secrets, 화면용은 holdem_tables.view)
 *  · 일어나면 left + cash_out(남은 칩) → 봇이 점수로 돌려준다 (딴 금액의 5% 수수료)
 * 시간 초과 · 다음 판 시작은 누구든(화면 · 봇) tick 을 부르면 처리된다.
 */

type TableRow = {
  id: string;
  status: TableStatus;
  host_member: string;
  host_name: string;
  is_friendly: boolean;
  max_seats: number;
  version: number;
  turn_deadline: string | null;
  next_hand_at: string | null;
  updated_at: string;
};
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (value: string | null) => (value ? new Date(value).getTime() : null);
const fmt = (n: number) => n.toLocaleString("ko-KR");

// 봇이 시간 초과 처리를 부를 때: 서비스 키로 확인
const botKeys = new Set<string>();
async function isBotKey(key: string) {
  if (!key) return false;
  if (key === process.env.SUPABASE_SERVICE_ROLE_KEY || botKeys.has(key)) return true;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) },
    });
    if (response.ok) botKeys.add(key);
    return response.ok;
  } catch {
    return false;
  }
}

async function load(admin: Admin, tableId: string) {
  const [table, secret, seats] = await Promise.all([
    admin.from("holdem_tables").select("id,status,host_member,host_name,is_friendly,max_seats,version,turn_deadline,next_hand_at,updated_at").eq("id", tableId).maybeSingle(),
    admin.from("holdem_secrets").select("state,version").eq("table_id", tableId).maybeSingle(),
    admin.from("holdem_seats").select("id,table_id,member_id,name,status,buy_in,escrow_state").eq("table_id", tableId).in("status", SEAT_ACTIVE),
  ]);
  if (!table.data || !secret.data) return null;
  return {
    row: table.data as TableRow,
    state: secret.data.state as Table,
    version: secret.data.version as number,
    seats: (seats.data ?? []) as SeatRow[],
  };
}

const signature = (ctx: Ctx) =>
  JSON.stringify([ctx.t, ctx.status, ctx.turnDeadline, ctx.nextHandAt, [...ctx.seatUpdates.entries()]]);

async function save(admin: Admin, row: TableRow, version: number, ctx: Ctx) {
  const next = version + 1;
  const { data, error } = await admin
    .from("holdem_secrets")
    .update({ state: ctx.t, version: next })
    .eq("table_id", row.id)
    .eq("version", version)
    .select("table_id");
  if (error || (data ?? []).length !== 1) return false;
  const at = new Date().toISOString();
  for (const [id, fields] of ctx.seatUpdates) {
    await admin.from("holdem_seats").update({ ...fields, updated_at: at }).eq("id", id).eq("status", "seated");
  }
  await admin
    .from("holdem_tables")
    .update({
      view: publicView(ctx.t),
      version: next,
      hand_no: ctx.t.handNo,
      status: ctx.status,
      turn_deadline: ctx.turnDeadline ? iso(ctx.turnDeadline) : null,
      next_hand_at: ctx.nextHandAt ? iso(ctx.nextHandAt) : null,
      updated_at: at,
      ...(ctx.status === "closed" ? { closed_at: at } : {}),
    })
    .eq("id", row.id)
    .lt("version", next);
  return true;
}

// 읽고 → 고치고 → (바뀌었으면) 저장. 동시에 누르면 다시 읽어서 한 번 더
async function mutate(
  admin: Admin,
  tableId: string,
  change: (ctx: Ctx, seats: SeatRow[], now: number) => string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const loaded = await load(admin, tableId);
    if (!loaded) return { ok: false, error: "테이블을 찾지 못했습니다." };
    const ctx: Ctx = {
      t: structuredClone(loaded.state),
      status: loaded.row.status,
      turnDeadline: ms(loaded.row.turn_deadline),
      nextHandAt: ms(loaded.row.next_hand_at),
      updatedAt: ms(loaded.row.updated_at) ?? Date.now(),
      seatUpdates: new Map(),
    };
    const before = signature(ctx);
    const error = change(ctx, loaded.seats, Date.now());
    if (error) return { ok: false, error };
    if (signature(ctx) === before) return { ok: true };
    if (await save(admin, loaded.row, loaded.version, ctx)) return { ok: true };
  }
  return { ok: false, error: "동시에 처리하는 중이었어요. 다시 눌러 주세요." };
}

// 자리 신청 (봇이 점수 · 티켓을 차감하면 앉는다)
async function requestSeat(admin: Admin, memberId: string, table: { id: string; is_friendly: boolean }) {
  const { data: active } = await admin
    .from("holdem_seats")
    .select("id")
    .eq("member_id", memberId)
    .in("status", SEAT_ACTIVE)
    .limit(1);
  if ((active ?? []).length > 0) return "이미 다른 홀덤 테이블에 앉아 있습니다. 먼저 일어나 주세요.";

  let uid = "friendly";
  let name = "";
  if (table.is_friendly) {
    const player = await loadFriendlyPlayer(admin, memberId);
    if ("error" in player) return player.error;
    if (!player.free && player.tickets < 1) return FRIENDLY_TICKET_ERROR;
    uid = player.free ? "friendly" : player.uid;
    name = player.name;
  } else {
    const player = await loadPlayer(admin, memberId);
    if ("error" in player) return player.error;
    if (player.exp < BUY_IN) return `점수가 부족합니다. 바이인 ${fmt(BUY_IN)}점이 필요해요. (지금 ${fmt(player.exp)}점)`;
    if (player.tickets < 1) return "티켓이 부족합니다. 카톡에서 !티켓구매 로 살 수 있습니다.";
    uid = player.uid;
    name = player.name;
  }
  const { error } = await admin.from("holdem_seats").insert({
    table_id: table.id,
    member_id: memberId,
    name,
    uid,
    buy_in: BUY_IN,
    is_friendly: table.is_friendly,
    escrow_state: "requested",
  });
  return error ? `자리 신청 실패: ${error.message}` : null;
}

const ACTIONS = ["fold", "check", "call", "raise", "allin"];

export async function POST(request: Request) {
  const admin = getServerAdmin();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const tableId = typeof body.tableId === "string" ? body.tableId : "";

  // 봇: 시간 초과 · 다음 판 진행 (로그인 없이 서비스 키로)
  if (action === "tick" && (await isBotKey(request.headers.get("x-bot-key") ?? ""))) {
    const result = await mutate(admin, tableId, (ctx, seats, now) => (step(ctx, seats, now), null));
    return NextResponse.json(result);
  }

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;

  if (action === "create") {
    const { data: member } = await admin.from("members").select("name,active").eq("id", memberId).maybeSingle();
    if (!member?.active) return fail("활동 중인 회원만 할 수 있습니다.", 403);
    const friendly = body.friendly === true;
    const { data: table, error } = await admin
      .from("holdem_tables")
      .insert({ host_member: memberId, host_name: member.name, is_friendly: friendly, view: publicView(emptyTable()) })
      .select("id")
      .single();
    if (error || !table) return fail(`테이블을 만들지 못했습니다: ${error?.message ?? ""}`, 500);
    await admin.from("holdem_secrets").insert({ table_id: table.id, state: emptyTable(), version: 0 });
    const seatError = await requestSeat(admin, memberId, { id: table.id, is_friendly: friendly });
    if (seatError) {
      await admin.from("holdem_tables").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", table.id);
      return fail(seatError);
    }
    return NextResponse.json({ ok: true, id: table.id });
  }

  if (!tableId) return fail("테이블이 없습니다.");

  if (action === "sit") {
    const { data: table } = await admin.from("holdem_tables").select("id,status,is_friendly,max_seats").eq("id", tableId).maybeSingle();
    if (!table || table.status === "closed") return fail("닫힌 테이블입니다.");
    const { count } = await admin
      .from("holdem_seats")
      .select("id", { count: "exact", head: true })
      .eq("table_id", tableId)
      .in("status", SEAT_ACTIVE);
    if ((count ?? 0) >= table.max_seats) return fail("자리가 다 찼습니다.");
    const error = await requestSeat(admin, memberId, table);
    return error ? fail(error) : NextResponse.json({ ok: true });
  }

  if (action === "cards") {
    // 내 손패 (이번 판)
    const { data: secret } = await admin.from("holdem_secrets").select("state").eq("table_id", tableId).maybeSingle();
    const state = secret?.state as Table | undefined;
    const me = state?.players.find((p) => p.member === memberId && !p.empty);
    return NextResponse.json({ ok: true, handNo: state?.handNo ?? 0, hole: me && !me.out ? me.hole : [] });
  }

  if (action === "invite") {
    const result = await requestInvite(admin, "holdem", tableId, memberId);
    return result.ok ? NextResponse.json({ ok: true }) : fail(result.error);
  }

  if (action === "tick") {
    const result = await mutate(admin, tableId, (ctx, seats, now) => (step(ctx, seats, now), null));
    return result.ok ? NextResponse.json(result) : fail(result.error);
  }

  if (action === "leave") {
    // 아직 봇이 차감 전이면 신청만 취소
    await admin
      .from("holdem_seats")
      .update({ status: "cancelled", escrow_state: "failed", escrow_note: "신청 취소", updated_at: new Date().toISOString() })
      .eq("table_id", tableId)
      .eq("member_id", memberId)
      .eq("status", "escrow")
      .eq("escrow_state", "requested");
    const result = await mutate(admin, tableId, (ctx, seats, now) => {
      step(ctx, seats, now);
      const me = ctx.t.players.find((p) => p.member === memberId && !p.empty);
      if (!me) return null;
      me.leaving = true;
      step(ctx, seats, now);
      return null;
    });
    return result.ok ? NextResponse.json(result) : fail(result.error);
  }

  if (action === "back") {
    // 일어나기 취소 · 자리 비움 해제
    const result = await mutate(admin, tableId, (ctx) => {
      const me = ctx.t.players.find((p) => p.member === memberId && !p.empty);
      if (!me) return "자리에 없습니다.";
      me.leaving = false;
      me.strikes = 0;
      return null;
    });
    return result.ok ? NextResponse.json(result) : fail(result.error);
  }

  if (action === "act") {
    const type = String(body.type ?? "");
    if (!ACTIONS.includes(type)) return fail("알 수 없는 행동입니다.");
    const to = Number(body.to ?? 0);
    const handNo = Number(body.handNo ?? -1);
    const result = await mutate(admin, tableId, (ctx, seats, now) => {
      step(ctx, seats, now);
      const t = ctx.t;
      const me = t.players.find((p) => p.member === memberId && !p.empty);
      if (!me) return "자리에 앉아 있지 않습니다.";
      if (t.handNo !== handNo || t.stage === "showdown" || t.turn !== me.id) return "지금은 내 차례가 아닙니다.";
      if (type === "check" && legal(t).toCall > 0) return "지금은 체크할 수 없습니다. (콜 또는 폴드)";
      me.strikes = 0;
      apply(ctx, type === "raise" ? { type: "raise", to } : { type: type as Action["type"] }, now);
      step(ctx, seats, now);
      return null;
    });
    return result.ok ? NextResponse.json(result) : fail(result.error);
  }

  return fail("알 수 없는 요청입니다.");
}
