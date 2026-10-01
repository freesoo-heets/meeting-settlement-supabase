import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import {
  fail,
  hasActiveStakeGame,
  isAdminMember,
  requestInvite,
  loadMember,
  loadPlayer,
  requireMemberId,
  updateIfUnchanged,
  type Admin,
  type Player,
} from "../../../lib/gameServer";
import {
  MAX_STRIKES,
  TURN_SECONDS,
  clampShot,
  initialPieces,
  judge,
  simulate,
  type Piece,
  type Side,
} from "../../../lib/alkkagi";

/*
 * 알까기 API. 점수·티켓 처리는 오목과 같이 봇이 한다 (escrow → playing → finished → 정산).
 * 튕기기 결과는 서버가 물리 엔진으로 계산해 확정한다. 화면은 같은 엔진으로 재생만 한다.
 */

const TABLE = "alkkagi_games";
const MIN_STAKE = 10;
const MAX_STAKE = 1000;
const GRACE_MS = 2000;

type Seat = "host" | "guest";

type Game = {
  id: string;
  status: string;
  stake: number;
  host_member: string;
  guest_member: string | null;
  target_member: string | null;
  cho: Seat | null;
  turn: Seat | null;
  pieces: Piece[];
  shot_no: number;
  strikes: Partial<Record<Seat, number>> | null;
  turn_deadline: string | null;
  escrow_state: string;
  is_test?: boolean;
  is_friendly?: boolean;
  updated_at: string;
};

const other = (seat: Seat): Seat => (seat === "host" ? "guest" : "host");
const colorOf = (game: Game, seat: Seat): Side => (game.cho === seat ? "cho" : "han");
const seatOfColor = (game: Game, color: Side): Seat =>
  color === "cho" ? (game.cho as Seat) : other(game.cho as Seat);
const deadline = () => new Date(Date.now() + TURN_SECONDS * 1000).toISOString();
const now = () => new Date().toISOString();

async function loadGame(admin: Admin, id: string) {
  const { data } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as Game | null) ?? null;
}

// 시간 초과: 턴만 넘기고, 같은 사람이 3번 연속이면 패배
async function applyTimeout(admin: Admin, game: Game) {
  if (game.status !== "playing" || !game.turn || !game.turn_deadline) return false;
  if (Date.now() < new Date(game.turn_deadline).getTime() + GRACE_MS) return false;
  const strikes = { host: 0, guest: 0, ...game.strikes };
  strikes[game.turn] += 1;
  if (strikes[game.turn] >= MAX_STRIKES) {
    return updateIfUnchanged(admin, TABLE, game, {
      strikes,
      status: "finished",
      winner: other(game.turn),
      end_reason: "timeout",
      finished_at: now(),
      turn_deadline: null,
    });
  }
  return updateIfUnchanged(admin, TABLE, game, { strikes, turn: other(game.turn), turn_deadline: deadline() });
}

export async function POST(request: Request) {
  let admin: Admin;
  try {
    admin = getServerAdmin();
  } catch {
    return fail("서버 설정 오류", 500);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  const gameId = String(body?.gameId ?? "");

  const [auth, loaded] = await Promise.all([
    requireMemberId(request, admin),
    gameId ? loadGame(admin, gameId) : Promise.resolve(null),
  ]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;

  let me: Player = { memberId, name: "", uid: "", exp: 0, tickets: 0 };
  // 친선 대국은 점수·티켓을 보지 않는다 (봇 점수판에 없어도 할 수 있다)
  const friendly = action === "create" ? body?.friendly === true : !!loaded?.is_friendly;
  if ((action === "create" || action === "join") && friendly) {
    // 친선은 점수·티켓을 보지 않지만, !전적 기록용으로 카톡 user_id 는 있으면 저장한다
    const player = await loadPlayer(admin, memberId);
    if ("error" in player) {
      const member = await loadMember(admin, memberId);
      if ("error" in member) return fail(member.error, member.status);
      me = { memberId, name: member.name, uid: "friendly", exp: 0, tickets: 0 };
    } else {
      me = player;
    }
  } else if (action === "create" || action === "join") {
    const player = await loadPlayer(admin, memberId);
    if ("error" in player) return fail(player.error, player.status);
    me = player;
  }

  // ── 관리자 테스트 대국 (혼자 양쪽 · 점수·티켓·봇 없음) ──
  if (action === "create_test") {
    if (!(await isAdminMember(admin, memberId))) return fail("관리자만 테스트할 수 있습니다.", 403);
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    const { data, error } = await admin
      .from(TABLE)
      .insert({
        status: "playing",
        is_test: true,
        stake: 0,
        host_member: memberId,
        host_name: member.name,
        host_uid: "test",
        guest_member: memberId,
        guest_name: `${member.name}(테스트)`,
        guest_uid: "test",
        cho: "host",
        turn: "host",
        pieces: initialPieces(),
        started_at: now(),
        turn_deadline: deadline(),
      })
      .select("id")
      .single();
    if (error) return fail(`만들기 실패: ${error.message}`, 500);
    return NextResponse.json({ ok: true, id: data.id });
  }

  // ── 방 만들기 / 대국신청 ──
  if (action === "create") {
    const stake = friendly ? 0 : Math.floor(Number(body?.stake));
    if (!friendly) {
      if (!Number.isFinite(stake) || stake < MIN_STAKE || stake > MAX_STAKE) {
        return fail(`판돈은 ${MIN_STAKE}~${MAX_STAKE}점입니다.`);
      }
      if (me.exp < stake) return fail(`점수가 부족합니다. (보유 ${me.exp.toLocaleString("ko-KR")}점)`);
      if (me.tickets < 1) return fail("티켓이 1장 필요합니다. 카톡에서 !티켓구매 로 살 수 있습니다.");
    }
    if (await hasActiveStakeGame(admin, TABLE, memberId)) return fail("이미 진행 중이거나 대기 중인 알까기가 있습니다.");

    const targetId = body?.targetMemberId ? String(body.targetMemberId) : null;
    if (targetId === memberId) return fail("자기 자신에게는 신청할 수 없습니다.");
    if (targetId) {
      const { data: target } = await admin.from("members").select("id,active").eq("id", targetId).maybeSingle();
      if (!target?.active) return fail("상대 회원을 찾지 못했습니다.");
      // ★ 점수 내기면 상대의 점수·티켓도 미리 확인 (모자라면 신청 자체를 막는다, 친선은 확인 안 함)
      if (!friendly) {
        const opponent = await loadPlayer(admin, targetId);
        if ("error" in opponent) return fail("상대를 카톡 점수판에서 찾지 못해 대국신청을 보낼 수 없습니다. (친선전은 가능)");
        if (opponent.tickets < 1) return fail(`${opponent.name}님이 티켓이 없어서 대국신청을 보낼 수 없습니다. (친선전은 가능)`);
        if (opponent.exp < stake) {
          return fail(`${opponent.name}님의 점수가 판돈보다 적습니다. (보유 ${opponent.exp.toLocaleString("ko-KR")}점)`);
        }
      }
    }

    const { data, error } = await admin
      .from(TABLE)
      .insert({
        status: targetId ? "challenge" : "open",
        stake,
        is_friendly: friendly,
        host_member: memberId,
        host_name: me.name,
        host_uid: me.uid,
        target_member: targetId,
      })
      .select("id")
      .single();
    if (error) return fail(`만들기 실패: ${error.message}`, 500);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (!gameId) return fail("대국 정보가 없습니다.");
  const game = loaded;
  if (!game) return fail("대국을 찾지 못했습니다.", 404);
  // 테스트 대국은 혼자 양쪽을 친다
  const seat: Seat | null =
    game.is_test && game.host_member === memberId
      ? game.turn ?? "host"
      : game.host_member === memberId
        ? "host"
        : game.guest_member === memberId
          ? "guest"
          : null;

  // ── 입장 / 수락 ──
  if (action === "join") {
    if (game.status !== "open" && game.status !== "challenge") return fail("이미 시작했거나 끝난 대국입니다.");
    if (game.host_member === memberId) return fail("내가 만든 방입니다.");
    if (game.status === "challenge" && game.target_member !== memberId) return fail("나에게 온 대국신청이 아닙니다.");
    if (!friendly) {
      if (me.exp < game.stake) return fail(`점수가 부족합니다. (보유 ${me.exp.toLocaleString("ko-KR")}점)`);
      if (me.tickets < 1) return fail("티켓이 1장 필요합니다. 카톡에서 !티켓구매 로 살 수 있습니다.");
    }
    if (await hasActiveStakeGame(admin, TABLE, memberId)) return fail("이미 진행 중이거나 대기 중인 알까기가 있습니다.");

    const cho: Seat = Math.random() < 0.5 ? "host" : "guest";
    const ok = await updateIfUnchanged(admin, TABLE, game, {
      guest_member: memberId,
      guest_name: me.name,
      guest_uid: me.uid,
      cho,
      turn: cho, // 초가 먼저
      pieces: initialPieces(),
      // 친선은 봇 확인 없이 바로 시작, 점수 내기는 봇이 판돈·티켓을 차감한 뒤 시작
      ...(friendly
        ? { status: "playing", started_at: now(), turn_deadline: deadline() }
        : { status: "escrow", escrow_state: "requested" }),
    });
    if (!ok) return fail("다른 사람이 먼저 입장했습니다.", 409);
    return NextResponse.json({ ok: true });
  }

  // ── 카톡방 초대 메시지 보내기 (방장이 직접 누른다) ──
  if (action === "invite") {
    if (game.host_member !== memberId) return fail("방장만 초대 메시지를 보낼 수 있습니다.");
    if (game.status !== "open" && game.status !== "challenge") return fail("대기 중인 대국만 초대할 수 있습니다.");
    if (game.is_test) return fail("테스트 대국은 초대 메시지를 보내지 않습니다.");
    const result = await requestInvite(admin, "alkkagi", game.id, memberId);
    if (!result.ok) return fail(result.error, 429);
    return NextResponse.json({ ok: true });
  }

  if (action === "decline") {
    if (game.status !== "challenge" || game.target_member !== memberId) return fail("거절할 수 없는 대국입니다.");
    await updateIfUnchanged(admin, TABLE, game, { status: "cancelled", end_reason: "declined", finished_at: now() });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    if (!seat) return fail("내 대국이 아닙니다.");
    const cancellable =
      game.status === "open" ||
      game.status === "challenge" ||
      (game.status === "escrow" && game.escrow_state === "requested");
    if (!cancellable) return fail("이미 시작한 대국은 취소할 수 없습니다. (기권은 가능)");
    let query = admin
      .from(TABLE)
      .update({ status: "cancelled", end_reason: "cancel", finished_at: now(), updated_at: now() })
      .eq("id", game.id)
      .eq("status", game.status);
    if (game.status === "escrow") query = query.eq("escrow_state", "requested");
    const { data } = await query.select("id");
    if ((data ?? []).length !== 1) return fail("이미 대국이 시작되었습니다.", 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "tick") {
    const changed = await applyTimeout(admin, game);
    return NextResponse.json({ ok: true, changed });
  }

  if (!seat) return fail("내 대국이 아닙니다.");

  if (action === "resign") {
    if (game.status !== "playing") return fail("진행 중인 대국이 아닙니다.");
    const ok = await updateIfUnchanged(admin, TABLE, game, {
      status: "finished",
      winner: other(seat),
      end_reason: "resign",
      finished_at: now(),
      turn_deadline: null,
    });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // ── 튕기기 ──
  if (action === "shoot") {
    if (game.status !== "playing") return fail("진행 중인 대국이 아닙니다.");
    if (await applyTimeout(admin, game)) return fail("시간이 초과되어 턴이 넘어갔습니다.", 409);
    if (game.turn !== seat) return fail("상대 차례입니다.");

    const pieceId = String(body?.pieceId ?? "");
    const myColor = colorOf(game, seat);
    const piece = game.pieces.find((item) => item.id === pieceId);
    if (!piece || piece.out || piece.side !== myColor) return fail("내 알을 골라 주세요.");

    const { vx, vy } = clampShot(Number(body?.vx), Number(body?.vy));
    if (Math.hypot(vx, vy) < 30) return fail("조금 더 세게 당겨 주세요.");

    const shotNo = game.shot_no + 1;
    const pieces = simulate(game.pieces, { id: pieceId, vx, vy });
    const result = judge(pieces, myColor, shotNo);
    const strikes = { host: 0, guest: 0, ...game.strikes, [seat]: 0 };

    const fields: Record<string, unknown> = {
      pieces,
      shot_no: shotNo,
      strikes,
      last_shot: { no: shotNo, id: pieceId, vx, vy, before: game.pieces },
    };
    if (result) {
      fields.status = "finished";
      fields.winner = result === "draw" ? "draw" : seatOfColor(game, result);
      fields.end_reason = result === "draw" ? "draw" : "knockout";
      fields.finished_at = now();
      fields.turn_deadline = null;
    } else {
      fields.turn = other(seat);
      fields.turn_deadline = deadline();
    }

    const ok = await updateIfUnchanged(admin, TABLE, game, fields);
    if (!ok) return fail("판이 바뀌었습니다. 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  return fail("알 수 없는 요청입니다.");
}
