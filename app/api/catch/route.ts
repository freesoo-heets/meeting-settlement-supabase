import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, requireMemberId, updateIfUnchanged, type Admin } from "../../../lib/gameServer";
import { hintOf, normalizeGuess, pickWord } from "../../../lib/catchWords";

/*
 * 캐치마인드 API (점수 내기 없음)
 * 제시어는 catch_secrets 에만 두고, 출제자가 word 요청을 할 때만 돌려준다.
 * 그림·채팅은 화면끼리 실시간 채널로 주고받고, 정답 확인과 턴 진행만 여기서 한다.
 */

const TABLE = "catch_rooms";
const MAX_PLAYERS = 6;
const ROUNDS = 2;
const DRAW_SECONDS = 80;
const REVEAL_SECONDS = 4;
const GRACE_MS = 1500;
const GUESS_POINTS = 10;
const RECRUIT_COOLDOWN_MS = 60 * 1000; // 모집 알림 도배 방지
const DRAWER_POINTS = 5;

type Member = { id: string; name: string };

type Room = {
  id: string;
  status: "waiting" | "playing" | "finished" | "cancelled";
  host_member: string;
  host_name: string;
  players: Member[];
  turn_no: number;
  turn_total: number;
  drawer_member: string | null;
  phase: "drawing" | "reveal" | null;
  phase_deadline: string | null;
  scores: Record<string, number>;
  is_test?: boolean;
  recruit_at?: string | null;
  recruit_no?: number;
  updated_at: string;
};

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadRoom(admin: Admin, id: string) {
  const { data } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as Room | null) ?? null;
}

async function cleanupStale(admin: Admin) {
  const now = Date.now();
  await admin
    .from(TABLE)
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("status", "waiting")
    .lt("updated_at", new Date(now - 30 * 60 * 1000).toISOString());
  // 모두 떠나서 아무도 진행시키지 않는 방
  await admin
    .from(TABLE)
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("status", "playing")
    .lt("updated_at", new Date(now - 5 * 60 * 1000).toISOString());
}

async function inOtherRoom(admin: Admin, memberId: string) {
  const { data } = await admin
    .from(TABLE)
    .select("id")
    .in("status", ["waiting", "playing"])
    .contains("players", [{ id: memberId }])
    .limit(1);
  return (data ?? [])[0]?.id as string | undefined;
}

// 새 턴 시작 (턴이 다 끝났으면 게임 종료)
async function startTurn(admin: Admin, room: Room, turnNo: number, players: Member[]) {
  if (turnNo >= room.turn_total || players.length < (room.is_test ? 1 : 2)) {
    return updateIfUnchanged(admin, TABLE, room, {
      status: "finished",
      players,
      phase: null,
      phase_deadline: null,
      drawer_member: null,
      drawer_name: null,
    });
  }
  const drawer = players[turnNo % players.length];
  const { data: secret } = await admin.from("catch_secrets").select("used").eq("room_id", room.id).maybeSingle();
  const used = ((secret?.used as string[] | undefined) ?? []).slice(-200);
  const word = pickWord(used);

  const ok = await updateIfUnchanged(admin, TABLE, room, {
    status: "playing",
    players,
    turn_no: turnNo,
    drawer_member: drawer.id,
    drawer_name: drawer.name,
    phase: "drawing",
    phase_deadline: later(DRAW_SECONDS),
    hint: hintOf(word),
    reveal_word: null,
    last_winner: null,
  });
  if (ok) {
    await admin.from("catch_secrets").upsert({ room_id: room.id, word, used: [...used, word] });
  }
  return ok;
}

async function reveal(admin: Admin, room: Room, fields: Record<string, unknown>) {
  const { data: secret } = await admin.from("catch_secrets").select("word").eq("room_id", room.id).maybeSingle();
  return updateIfUnchanged(admin, TABLE, room, {
    phase: "reveal",
    phase_deadline: later(REVEAL_SECONDS),
    reveal_word: secret?.word ?? "",
    ...fields,
  });
}

// 시간이 지난 단계를 다음으로 넘긴다
async function advance(admin: Admin, room: Room) {
  if (room.status !== "playing" || !room.phase_deadline) return false;
  if (Date.now() < new Date(room.phase_deadline).getTime() + GRACE_MS) return false;
  if (room.phase === "drawing") return reveal(admin, room, { last_winner: null });
  return startTurn(admin, room, room.turn_no + 1, room.players);
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
  const roomId = String(body?.roomId ?? "");

  const [auth, loaded] = await Promise.all([
    requireMemberId(request, admin),
    roomId ? loadRoom(admin, roomId) : Promise.resolve(null),
  ]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;

  if (action === "create" || action === "create_test") {
    const test = action === "create_test";
    if (test && !(await isAdminMember(admin, memberId))) return fail("관리자만 테스트할 수 있습니다.", 403);
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    await cleanupStale(admin);
    const existing = await inOtherRoom(admin, memberId);
    if (existing) return NextResponse.json({ ok: true, id: existing, existing: true });

    const { data, error } = await admin
      .from(TABLE)
      .insert({
        host_member: memberId,
        host_name: member.name,
        players: [{ id: memberId, name: member.name }],
        max_players: MAX_PLAYERS,
        rounds: ROUNDS,
        is_test: test,
        // 테스트 방이 아니면 만들자마자 카톡방에 모집 알림 (봇이 올린다)
        recruit_at: test ? null : new Date().toISOString(),
        recruit_no: test ? 0 : 1,
      })
      .select("id")
      .single();
    if (error) return fail(`만들기 실패: ${error.message}`, 500);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (!roomId) return fail("방 정보가 없습니다.");
  const room = loaded;
  if (!room) return fail("방을 찾지 못했습니다.", 404);
  const inRoom = room.players.some((player) => player.id === memberId);

  if (action === "join") {
    if (inRoom) return NextResponse.json({ ok: true });
    if (room.status !== "waiting" && room.status !== "playing") return fail("끝난 방입니다.");
    if (room.players.length >= MAX_PLAYERS) return fail(`방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명)`);
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    const existing = await inOtherRoom(admin, memberId);
    if (existing && existing !== room.id) return fail("이미 다른 캐치마인드 방에 들어가 있습니다.");
    const ok = await updateIfUnchanged(admin, TABLE, room, {
      players: [...room.players, { id: member.id, name: member.name }],
    });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "tick") {
    const changed = await advance(admin, room);
    return NextResponse.json({ ok: true, changed });
  }

  if (!inRoom) return fail("방에 들어가 있지 않습니다.");

  if (action === "leave") {
    const players = room.players.filter((player) => player.id !== memberId);
    if (players.length === 0) {
      await updateIfUnchanged(admin, TABLE, room, { status: "cancelled", players });
      return NextResponse.json({ ok: true });
    }
    const hostFields =
      room.host_member === memberId ? { host_member: players[0].id, host_name: players[0].name } : {};

    if (room.status === "playing" && players.length < 2) {
      await updateIfUnchanged(admin, TABLE, room, { ...hostFields, status: "finished", players, phase: null });
      return NextResponse.json({ ok: true });
    }
    if (room.status === "playing" && room.drawer_member === memberId && room.phase === "drawing") {
      // 출제자가 나가면 이번 문제는 정답 공개 후 다음으로
      await reveal(admin, room, { ...hostFields, players, last_winner: null });
      return NextResponse.json({ ok: true });
    }
    await updateIfUnchanged(admin, TABLE, room, { ...hostFields, players });
    return NextResponse.json({ ok: true });
  }

  // ── 모집하기: 카톡방 알림 요청 (봇이 올린다) ──
  if (action === "recruit") {
    if (room.is_test) return fail("테스트 방은 모집 알림을 보내지 않습니다.");
    if (room.status !== "waiting" && room.status !== "playing") return fail("끝난 방입니다.");
    if (room.players.length >= MAX_PLAYERS) return fail("방이 이미 가득 찼습니다.");
    const last = room.recruit_at ? new Date(room.recruit_at).getTime() : 0;
    const wait = Math.ceil((last + RECRUIT_COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) return fail(`방금 모집 알림을 보냈어요. ${wait}초 뒤에 다시 보낼 수 있습니다.`);
    const ok = await updateIfUnchanged(admin, TABLE, room, {
      recruit_at: new Date().toISOString(),
      recruit_no: (room.recruit_no ?? 0) + 1,
    });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "start") {
    if (room.host_member !== memberId) return fail("방장만 시작할 수 있습니다.");
    if (room.status !== "waiting") return fail("이미 시작한 방입니다.");
    if (room.players.length < (room.is_test ? 1 : 2)) return fail("2명 이상 모여야 시작할 수 있습니다.");
    const scores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
    const prepared = { ...room, turn_total: room.players.length * ROUNDS };
    const { data } = await admin
      .from(TABLE)
      .update({ turn_total: prepared.turn_total, scores, updated_at: new Date().toISOString() })
      .eq("id", room.id)
      .eq("updated_at", room.updated_at)
      .select("updated_at")
      .single();
    if (!data) return fail("잠시 후 다시 시도해 주세요.", 409);
    await startTurn(admin, { ...prepared, scores, updated_at: data.updated_at as string }, 0, room.players);
    return NextResponse.json({ ok: true });
  }

  // ── 다시하기: 끝난 방을 같은 멤버로 바로 새로 시작 ──
  if (action === "restart") {
    if (room.status !== "finished") return fail("게임이 끝난 뒤에 다시 할 수 있습니다.");
    // 그사이 다른 방에 들어간 사람은 빼고 시작한다
    const players: Member[] = [];
    for (const player of room.players) {
      const other = await inOtherRoom(admin, player.id);
      if (!other || other === room.id) players.push(player);
    }
    const hostStays = players.some((player) => player.id === room.host_member);
    const hostFields = hostStays || players.length === 0 ? {} : { host_member: players[0].id, host_name: players[0].name };
    const scores = Object.fromEntries(players.map((player) => [player.id, 0]));
    const reset = {
      ...hostFields,
      players,
      scores,
      turn_no: 0,
      turn_total: players.length * ROUNDS,
      drawer_member: null,
      drawer_name: null,
      phase: null,
      phase_deadline: null,
      hint: null,
      reveal_word: null,
      last_winner: null,
    };

    // 인원이 모자라면 대기실로만 되돌린다
    if (players.length < (room.is_test ? 1 : 2)) {
      const ok = await updateIfUnchanged(admin, TABLE, room, { ...reset, status: "waiting" });
      if (!ok) return fail("이미 다시 시작했습니다.", 409);
      return NextResponse.json({ ok: true, waiting: true });
    }

    const { data } = await admin
      .from(TABLE)
      .update({ ...reset, updated_at: new Date().toISOString() })
      .eq("id", room.id)
      .eq("status", "finished")
      .eq("updated_at", room.updated_at)
      .select("updated_at")
      .single();
    if (!data) return fail("이미 다시 시작했습니다.", 409);
    await startTurn(
      admin,
      { ...room, ...reset, status: "finished", updated_at: data.updated_at as string } as Room,
      0,
      players,
    );
    return NextResponse.json({ ok: true });
  }

  // 출제자에게만 제시어를 알려준다
  if (action === "word") {
    if (room.status !== "playing" || room.phase !== "drawing" || room.drawer_member !== memberId) {
      return fail("지금은 출제자가 아닙니다.", 403);
    }
    const { data: secret } = await admin.from("catch_secrets").select("word").eq("room_id", room.id).maybeSingle();
    return NextResponse.json({ ok: true, word: secret?.word ?? "" });
  }

  if (action === "guess") {
    if (room.status !== "playing" || room.phase !== "drawing") return NextResponse.json({ ok: true, correct: false });
    if (room.drawer_member === memberId && !room.is_test) return fail("출제자는 맞힐 수 없습니다.");
    if (room.phase_deadline && Date.now() > new Date(room.phase_deadline).getTime() + GRACE_MS) {
      await advance(admin, room);
      return NextResponse.json({ ok: true, correct: false });
    }
    const text = String(body?.text ?? "").slice(0, 40);
    const { data: secret } = await admin.from("catch_secrets").select("word").eq("room_id", room.id).maybeSingle();
    if (!secret?.word || normalizeGuess(text) !== normalizeGuess(secret.word)) {
      return NextResponse.json({ ok: true, correct: false });
    }
    const me = room.players.find((player) => player.id === memberId);
    const scores = { ...room.scores };
    scores[memberId] = (scores[memberId] ?? 0) + GUESS_POINTS;
    if (room.drawer_member) scores[room.drawer_member] = (scores[room.drawer_member] ?? 0) + DRAWER_POINTS;
    const ok = await reveal(admin, room, { scores, last_winner: me?.name ?? "" });
    return NextResponse.json({ ok: true, correct: ok });
  }

  return fail("알 수 없는 요청입니다.");
}
