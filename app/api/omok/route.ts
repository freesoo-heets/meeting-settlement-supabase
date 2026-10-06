import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { CENTER, TURN_SECONDS, checkMove, type Move } from "../../../lib/omok";
import { isAdminMember, loadMember, requestInvite } from "../../../lib/gameServer";

/*
 * 오목 대국 API (모든 쓰기는 여기서만 한다)
 *
 * 점수·티켓은 사이트가 직접 건드리지 않는다.
 * 대국이 성사되면 escrow_state='requested' 로 두고, 봇이 판돈·티켓을 차감한 뒤 playing 으로 바꾼다.
 * 끝나면 finished 로 두고, 봇이 승자에게 지급한다.
 */

const MIN_STAKE = 10;
const MAX_STAKE = 1000;
const GRACE_MS = 2000; // 통신 지연 여유
const ACTIVE = ["open", "challenge", "escrow", "playing"];
const MAX_UNDO = 3; // 한 사람당 한 판에 무르기 횟수

type Admin = ReturnType<typeof getServerAdmin>;

type Game = {
  id: string;
  status: string;
  stake: number;
  host_member: string;
  host_name: string;
  host_uid: string;
  guest_member: string | null;
  guest_name: string | null;
  guest_uid: string | null;
  target_member: string | null;
  black: "host" | "guest" | null;
  moves: Move[];
  turn_deadline: string | null;
  escrow_state: string;
  is_test?: boolean;
  is_friendly?: boolean;
  undo?: { pending?: { by: "host" | "guest"; n: number; k?: number } | null; used?: Partial<Record<"host" | "guest", number>> } | null;
  updated_at: string;
};

type Player = { memberId: string; name: string; uid: string; exp: number; tickets: number };

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// 로그인 확인 → 회원 id 만 (착수·기권처럼 자주 오는 요청은 여기까지만 확인해 빠르게 처리)
async function requireMemberId(request: Request, admin: Admin): Promise<{ memberId: string } | { error: string; status: number }> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { error: "로그인이 필요합니다.", status: 401 };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { error: "로그인 세션이 유효하지 않습니다.", status: 401 };

  const { data: profile } = await admin
    .from("profiles")
    .select("member_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.member_id) return { error: "회원 명단과 연결된 계정만 할 수 있습니다.", status: 403 };
  return { memberId: profile.member_id as string };
}

// 방 만들기·입장 때만: 활동 회원인지, 봇 점수판의 점수·티켓 확인
async function loadPlayer(admin: Admin, memberId: string): Promise<Player | { error: string; status: number }> {
  const { data: member } = await admin
    .from("members")
    .select("id,name,active")
    .eq("id", memberId)
    .maybeSingle();
  if (!member || !member.active) return { error: "활동 중인 회원만 할 수 있습니다.", status: 403 };

  const point = await findBotPoint(admin, member.name);
  if (!point) return { error: "카톡 봇 점수판에서 회원님을 찾지 못했습니다. (닉네임 확인)", status: 403 };

  return { memberId: member.id, name: member.name, uid: point.kakao_uid, exp: point.exp, tickets: point.tickets };
}

async function findBotPoint(admin: Admin, name: string) {
  const normalize = (value: string) => value.split(" ").join("").toLowerCase();
  const { data } = await admin.from("bot_points").select("kakao_uid,name,exp,tickets");
  const rows = (data ?? []).filter((row) => normalize(row.name) === normalize(name));
  rows.sort((a, b) => b.exp - a.exp);
  return rows[0] ?? null;
}

async function hasActiveGame(admin: Admin, memberId: string) {
  const { data } = await admin
    .from("omok_games")
    .select("id")
    .in("status", ACTIVE)
    .or(`host_member.eq.${memberId},guest_member.eq.${memberId}`)
    .limit(1);
  return (data ?? []).length > 0;
}

async function loadGame(admin: Admin, id: string) {
  const { data } = await admin.from("omok_games").select("*").eq("id", id).maybeSingle();
  return (data as Game | null) ?? null;
}

// updated_at 이 그대로일 때만 고친다 (동시에 두 요청이 와도 한쪽만 반영)
async function updateGame(admin: Admin, game: Game, fields: Record<string, unknown>) {
  const { data, error } = await admin
    .from("omok_games")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", game.id)
    .eq("updated_at", game.updated_at)
    .select("id");
  return !error && (data ?? []).length === 1;
}

function sideOf(game: Game, memberId: string): "host" | "guest" | null {
  if (game.host_member === memberId) return "host";
  if (game.guest_member === memberId) return "guest";
  return null;
}

function turnSide(game: Game): "host" | "guest" {
  const blackTurn = game.moves.length % 2 === 0;
  const white = game.black === "host" ? "guest" : "host";
  return blackTurn ? (game.black as "host" | "guest") : white;
}

function other(side: "host" | "guest") {
  return side === "host" ? "guest" : "host";
}

function deadlineFromNow() {
  return new Date(Date.now() + TURN_SECONDS * 1000).toISOString();
}

async function finishIfTimedOut(admin: Admin, game: Game) {
  if (game.status !== "playing" || !game.turn_deadline) return false;
  if (Date.now() < new Date(game.turn_deadline).getTime() + GRACE_MS) return false;
  return updateGame(admin, game, {
    status: "finished",
    winner: other(turnSide(game)),
    end_reason: "timeout",
    finished_at: new Date().toISOString(),
  });
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

  // 로그인 확인과 대국 불러오기를 동시에 한다
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
      .from("omok_games")
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
        black: "host",
        moves: [[CENTER, CENTER]],
        started_at: new Date().toISOString(),
        turn_deadline: deadlineFromNow(),
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
    if (await hasActiveGame(admin, me.memberId)) return fail("이미 진행 중이거나 대기 중인 대국이 있습니다.");

    const targetId = body?.targetMemberId ? String(body.targetMemberId) : null;
    if (targetId === me.memberId) return fail("자기 자신에게는 도전할 수 없습니다.");
    if (targetId) {
      const { data: target } = await admin.from("members").select("id,active").eq("id", targetId).maybeSingle();
      if (!target?.active) return fail("도전할 회원을 찾지 못했습니다.");
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
      .from("omok_games")
      .insert({
        status: targetId ? "challenge" : "open",
        stake,
        is_friendly: friendly,
        host_member: me.memberId,
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

  // ── 입장 / 도전 수락 ──
  if (action === "join") {
    if (game.status !== "open" && game.status !== "challenge") return fail("이미 시작했거나 끝난 대국입니다.");
    if (game.host_member === me.memberId) return fail("내가 만든 방입니다.");
    if (game.status === "challenge" && game.target_member !== me.memberId) return fail("나에게 온 대국신청이 아닙니다.");
    if (!friendly) {
      if (me.exp < game.stake) return fail(`점수가 부족합니다. (보유 ${me.exp.toLocaleString("ko-KR")}점)`);
      if (me.tickets < 1) return fail("티켓이 1장 필요합니다. 카톡에서 !티켓구매 로 살 수 있습니다.");
    }
    if (await hasActiveGame(admin, me.memberId)) return fail("이미 진행 중이거나 대기 중인 대국이 있습니다.");

    const black = Math.random() < 0.5 ? "host" : "guest";
    const ok = await updateGame(admin, game, {
      guest_member: me.memberId,
      guest_name: me.name,
      guest_uid: me.uid,
      black,
      moves: [[CENTER, CENTER]], // 흑 첫 수는 천원 고정
      // 친선은 봇 확인 없이 바로 시작, 점수 내기는 봇이 판돈·티켓을 차감한 뒤 시작
      ...(friendly
        ? { status: "playing", started_at: new Date().toISOString(), turn_deadline: deadlineFromNow() }
        : { status: "escrow", escrow_state: "requested" }),
    });
    if (!ok) return fail("다른 사람이 먼저 입장했습니다.", 409);
    return NextResponse.json({ ok: true });
  }

  // ── 도전 거절 ──
  // ── 카톡방 초대 메시지 보내기 (방장이 직접 누른다) ──
  if (action === "invite") {
    if (game.host_member !== me.memberId) return fail("방장만 초대 메시지를 보낼 수 있습니다.");
    if (game.status !== "open" && game.status !== "challenge") return fail("대기 중인 대국만 초대할 수 있습니다.");
    if (game.is_test) return fail("테스트 대국은 초대 메시지를 보내지 않습니다.");
    const result = await requestInvite(admin, "omok", game.id, me.memberId);
    if (!result.ok) return fail(result.error, 429);
    return NextResponse.json({ ok: true });
  }

  if (action === "decline") {
    if (game.status !== "challenge" || game.target_member !== me.memberId) return fail("거절할 수 없는 대국입니다.");
    await updateGame(admin, game, { status: "cancelled", end_reason: "declined", finished_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }

  // ── 취소 (시작 전만) ──
  if (action === "cancel") {
    const side = sideOf(game, me.memberId);
    if (!side) return fail("내 대국이 아닙니다.");
    const cancellable =
      game.status === "open" ||
      game.status === "challenge" ||
      (game.status === "escrow" && game.escrow_state === "requested");
    if (!cancellable) return fail("이미 시작한 대국은 취소할 수 없습니다. (기권은 가능)");

    // 봇이 차감을 시작하기 전일 때만 취소된다
    let query = admin
      .from("omok_games")
      .update({ status: "cancelled", end_reason: "cancel", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", game.id)
      .eq("status", game.status);
    if (game.status === "escrow") query = query.eq("escrow_state", "requested");
    const { data } = await query.select("id");
    if ((data ?? []).length !== 1) return fail("이미 대국이 시작되었습니다.", 409);
    return NextResponse.json({ ok: true });
  }

  // 테스트 대국은 혼자 양쪽을 둔다
  const side = game.is_test && game.host_member === me.memberId ? turnSide(game) : sideOf(game, me.memberId);

  // ── 시간 초과 확인 (양쪽 화면 누구나 호출) ──
  if (action === "tick") {
    const finished = await finishIfTimedOut(admin, game);
    return NextResponse.json({ ok: true, finished });
  }

  if (!side) return fail("내 대국이 아닙니다.");

  // ── 기권 ──
  if (action === "resign") {
    if (game.status !== "playing") return fail("진행 중인 대국이 아닙니다.");
    const ok = await updateGame(admin, game, {
      status: "finished",
      winner: other(side),
      end_reason: "resign",
      finished_at: new Date().toISOString(),
    });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // ── 무르기 요청: 내 마지막 수를 무른다. 상대가 이미 뒀으면 상대 수까지 2수를 되돌린다 ──
  if (action === "undo_request") {
    if (game.status !== "playing") return fail("진행 중인 대국이 아닙니다.");
    if (game.moves.length < 2) return fail("무를 수가 없습니다.");
    const lastBy = game.moves.length % 2 === 1 ? game.black : game.black === "host" ? "guest" : "host";
    const used = { host: 0, guest: 0, ...(game.undo?.used ?? {}) };

    // 테스트 대국은 혼자 두므로 바로 물러준다
    if (game.is_test && game.host_member === me.memberId) {
      const ok = await updateGame(admin, game, {
        moves: game.moves.slice(0, -1),
        turn_deadline: deadlineFromNow(),
        undo: { ...(game.undo ?? {}), pending: null },
      });
      return ok ? NextResponse.json({ ok: true, undone: true }) : fail("판이 바뀌었습니다.", 409);
    }

    // 상대가 아직 안 뒀으면 1수, 이미 뒀으면 상대 수 + 내 수 2수
    const k = lastBy === side ? 1 : 2;
    if (k === 2 && game.moves.length < 3) return fail("무를 수가 없습니다.");
    if (game.undo?.pending) return fail("이미 무르기를 요청했습니다.");
    if ((used[side] ?? 0) >= MAX_UNDO) return fail(`무르기는 한 판에 ${MAX_UNDO}번까지입니다.`);
    const ok = await updateGame(admin, game, {
      undo: { ...(game.undo ?? {}), used, pending: { by: side, n: game.moves.length, k } },
    });
    if (!ok) return fail("판이 바뀌었습니다. 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // ── 무르기 응답: 상대가 수락하면 마지막 수를 되돌린다 ──
  if (action === "undo_answer") {
    const pending = game.undo?.pending;
    if (game.status !== "playing" || !pending) return fail("무르기 요청이 없습니다.");
    if (pending.by === side) return fail("상대의 응답을 기다리는 중입니다.");
    const used = { host: 0, guest: 0, ...(game.undo?.used ?? {}) };
    if (body?.accept !== true || pending.n !== game.moves.length) {
      const ok = await updateGame(admin, game, { undo: { used, pending: null } });
      return ok ? NextResponse.json({ ok: true, undone: false }) : fail("판이 바뀌었습니다.", 409);
    }
    used[pending.by] = (used[pending.by] ?? 0) + 1;
    const ok = await updateGame(admin, game, {
      moves: game.moves.slice(0, -(pending.k ?? 1)),
      turn_deadline: deadlineFromNow(), // 다시 요청한 사람 차례, 시간 새로
      undo: { used, pending: null },
    });
    if (!ok) return fail("판이 바뀌었습니다. 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true, undone: true });
  }

  // ── 착수 ──
  if (action === "move") {
    if (game.status !== "playing") return fail("진행 중인 대국이 아닙니다.");
    if (await finishIfTimedOut(admin, game)) return fail("시간이 초과되었습니다.", 409);
    if (turnSide(game) !== side) return fail("상대 차례입니다.");

    const x = Number(body?.x);
    const y = Number(body?.y);
    const result = checkMove(game.moves, x, y);
    if (!result.ok) return fail(result.reason);

    const moves = [...game.moves, [x, y]];
    // 상대가 다음 수를 두면 걸려 있던 무르기 요청은 사라진다
    const fields: Record<string, unknown> = { moves, undo: { ...(game.undo ?? {}), pending: null } };
    if (result.win || result.draw) {
      fields.status = "finished";
      fields.winner = result.win ? side : "draw";
      fields.end_reason = result.win ? "five" : "draw";
      fields.finished_at = new Date().toISOString();
      fields.turn_deadline = null;
    } else {
      fields.turn_deadline = deadlineFromNow();
    }

    const ok = await updateGame(admin, game, fields);
    if (!ok) return fail("판이 바뀌었습니다. 다시 두어 주세요.", 409);
    return NextResponse.json({ ok: true, win: result.ok && result.win });
  }

  return fail("알 수 없는 요청입니다.");
}
