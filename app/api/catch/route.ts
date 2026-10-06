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
  drawer_name?: string | null;
  play_no?: number;
  reveal_word?: string | null;
  last_winner?: string | null;
  recruit_no?: number;
  updated_at: string;
};

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadRoom(admin: Admin, id: string) {
  const { data } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as Room | null) ?? null;
}

// 유령 방 정리. force=true 면 한 명만 있는 대기방을 시간과 상관없이 모두 닫는다 (관리자 버튼)
async function cleanupStale(admin: Admin, force = false) {
  const now = Date.now();
  const stamp = new Date().toISOString();

  // 혼자 남은 대기방: 30분 동안 변화가 없으면 (force 면 바로) 닫는다
  const { data: waiting } = await admin
    .from(TABLE)
    .select("id,players,updated_at")
    .eq("status", "waiting")
    .limit(200);
  const lonely = (waiting ?? [])
    .filter((room) => ((room.players as Member[] | null) ?? []).length <= 1)
    .filter((room) => force || new Date(room.updated_at as string).getTime() < now - 30 * 60 * 1000)  // 혼자 기다리는 방은 30분
    .map((room) => room.id as string);
  if (lonely.length > 0) {
    await admin.from(TABLE).update({ status: "cancelled", updated_at: stamp }).in("id", lonely);
  }

  // 여러 명이어도 30분 동안 시작하지 않은 대기방
  await admin
    .from(TABLE)
    .update({ status: "cancelled", updated_at: stamp })
    .eq("status", "waiting")
    .lt("updated_at", new Date(now - 30 * 60 * 1000).toISOString());
  // 모두 떠나서 아무도 진행시키지 않는 방
  await admin
    .from(TABLE)
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("status", "playing")
    .lt("updated_at", new Date(now - 5 * 60 * 1000).toISOString());
}

// 내가 들어가 있는 방들 (최근 것부터)
// ★ players 는 jsonb 라서 JSON 문자열로 넘겨야 한다.
//   배열을 그대로 넘기면 'cs.{[object Object]}' 로 바뀌어 조회가 늘 실패했고,
//   그 바람에 방 만들기를 누를 때마다 새 방이 생기는 버그가 있었다.
async function myRooms(admin: Admin, memberId: string) {
  const { data, error } = await admin
    .from(TABLE)
    .select("id,players,status,is_test,created_at")
    .in("status", ["waiting", "playing"])
    .contains("players", JSON.stringify([{ id: memberId }]))
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`방 조회 실패: ${error.message}`);
  return (data ?? []) as Array<{ id: string; players: Member[]; status: string; is_test: boolean }>;
}

async function inOtherRoom(admin: Admin, memberId: string) {
  return (await myRooms(admin, memberId))[0]?.id as string | undefined;
}

// 나 혼자 남아 있는 대기방이 여러 개면 가장 최근 것만 남기고 닫는다 (예전 버그로 쌓인 방 정리)
async function closeDuplicateRooms(admin: Admin, memberId: string) {
  const rooms = await myRooms(admin, memberId);
  const extra = rooms
    .slice(1)
    .filter((room) => room.status === "waiting" && room.players.length === 1 && room.players[0].id === memberId);
  if (extra.length > 0) {
    await admin
      .from(TABLE)
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in(
        "id",
        extra.map((room) => room.id),
      );
  }
  return rooms[0]?.id as string | undefined;
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
  // 진단용 기록 (Vercel 로그에서 확인)
  console.log("[catch]", action, "member", memberId.slice(0, 8), "room", roomId.slice(0, 8), loaded ? `${loaded.status}/${loaded.is_test ? "test" : "normal"}/${loaded.players.length}명` : "-");

  // ── 유령 방 정리 (게임 로비·목록을 열 때마다 화면이 부른다. 관리자는 즉시 정리 가능) ──
  if (action === "cleanup") {
    const force = body?.force === true && (await isAdminMember(admin, memberId));
    const before = await admin.from(TABLE).select("id", { count: "exact", head: true }).in("status", ["waiting", "playing"]);
    await cleanupStale(admin, force);
    const after = await admin.from(TABLE).select("id", { count: "exact", head: true }).in("status", ["waiting", "playing"]);
    return NextResponse.json({ ok: true, closed: Math.max(0, (before.count ?? 0) - (after.count ?? 0)) });
  }

  if (action === "create" || action === "create_test") {
    const test = action === "create_test";
    if (test && !(await isAdminMember(admin, memberId))) return fail("관리자만 테스트할 수 있습니다.", 403);
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    await cleanupStale(admin);
    // 이미 들어가 있는 방이 있으면 새로 만들지 않고 그 방으로 보낸다
    await closeDuplicateRooms(admin, memberId);
    const [current] = await myRooms(admin, memberId);
    if (current) {
      const aloneWaiting =
        current.status === "waiting" && current.players.length === 1 && current.players[0].id === memberId;
      if (!!current.is_test === test || !aloneWaiting) {
        // 같은 종류의 방이거나, 다른 사람이 함께 있는 방이면 그 방으로
        console.log("[catch] create → 기존 방", current.id.slice(0, 8), current.status, current.is_test ? "test" : "normal");
        return NextResponse.json({ ok: true, id: current.id, existing: true });
      }
      // 혼자 기다리던 방이 종류가 다르면(일반 ↔ 테스트) 닫고 새로 만든다
      await admin
        .from(TABLE)
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", current.id);
    }

    const { data, error } = await admin
      .from(TABLE)
      .insert({
        host_member: memberId,
        host_name: member.name,
        players: [{ id: memberId, name: member.name }],
        max_players: MAX_PLAYERS,
        rounds: ROUNDS,
        is_test: test,
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

  // ── 나가기 · 접속이 끊긴 사람 내보내기 ──
  //   leave        : 내가 나간다
  //   remove_absent: 창을 닫거나 연결이 끊긴 지 10초 넘은 사람들을 같은 방 사람이 내보낸다 (점수 없는 게임이라 화면 판단을 믿는다)
  if (action === "leave" || action === "remove_absent") {
    const removeIds =
      action === "leave"
        ? [memberId]
        : (Array.isArray(body?.ids) ? (body?.ids as unknown[]) : [])
            .map(String)
            .filter((id) => id !== memberId && room.players.some((player) => player.id === id));
    if (removeIds.length === 0) return NextResponse.json({ ok: true });
    if (room.status !== "waiting" && room.status !== "playing") return NextResponse.json({ ok: true });

    const players = room.players.filter((player) => !removeIds.includes(player.id));
    if (players.length === 0) {
      await updateIfUnchanged(admin, TABLE, room, { status: "cancelled", players });
      return NextResponse.json({ ok: true });
    }
    const hostFields = removeIds.includes(room.host_member) ? { host_member: players[0].id, host_name: players[0].name } : {};

    if (room.status === "playing" && players.length < (room.is_test ? 1 : 2)) {
      await updateIfUnchanged(admin, TABLE, room, { ...hostFields, status: "finished", players, phase: null });
      return NextResponse.json({ ok: true });
    }
    if (room.status === "playing" && room.drawer_member && removeIds.includes(room.drawer_member) && room.phase === "drawing") {
      // 출제자가 나가면 이번 문제는 정답 공개 후 다음으로
      await reveal(admin, room, { ...hostFields, players, last_winner: null });
      return NextResponse.json({ ok: true });
    }
    await updateIfUnchanged(admin, TABLE, room, { ...hostFields, players });
    return NextResponse.json({ ok: true });
  }

  // ── 방장 넘겨받기: 대기 중 방장이 자리를 비웠을 때 (점수 없는 게임이라 화면 판단을 믿는다) ──
  if (action === "take_host") {
    if (room.status !== "waiting") return fail("대기 중일 때만 방장을 바꿀 수 있습니다.");
    if (room.host_member === memberId) return NextResponse.json({ ok: true });
    const me = room.players.find((player) => player.id === memberId);
    if (!me) return fail("방에 들어가 있지 않습니다.");
    const ok = await updateIfUnchanged(admin, TABLE, room, { host_member: me.id, host_name: me.name });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
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

  // ── 그림 저장: 문제가 끝나면 출제자 화면이 보낸다 (최근 그림 갤러리용) ──
  if (action === "save_drawing") {
    const turnNo = Number(body?.turnNo);
    if (room.drawer_member !== memberId) return fail("출제자만 저장할 수 있습니다.", 403);
    // 정답이 공개된 그 문제일 때만 (다음 문제로 넘어갔으면 제시어를 알 수 없다)
    if (room.turn_no !== turnNo || !room.reveal_word) return fail("저장할 수 있는 때가 지났습니다.", 409);

    const raw = Array.isArray(body?.strokes) ? (body?.strokes as unknown[]) : [];
    const strokes = raw.slice(0, 400).map((item) => {
      const stroke = item as { color?: unknown; size?: unknown; pts?: unknown };
      const pts = Array.isArray(stroke.pts) ? (stroke.pts as unknown[]) : [];
      return {
        color: /^#[0-9a-fA-F]{6}$/.test(String(stroke.color)) ? String(stroke.color) : "#111111",
        size: Math.min(40, Math.max(1, Number(stroke.size) || 8)),
        pts: pts
          .slice(0, 800)
          .map((pt) => (Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [NaN, NaN]))
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1)
          .map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
      };
    });

    const { error } = await admin.from("catch_drawings").upsert(
      {
        room_id: room.id,
        play_no: room.play_no ?? 0,
        turn_no: turnNo,
        drawer_member: memberId,
        drawer_name: room.drawer_name ?? "",
        word: room.reveal_word,
        winner: room.last_winner || null,
        strokes,
        is_test: !!room.is_test,
      },
      { onConflict: "room_id,play_no,turn_no" },
    );
    if (error) return fail(`저장 실패: ${error.message}`, 500);
    return NextResponse.json({ ok: true });
  }

  // ── 다시하기: 누른 사람만 새 판에 참가한다 ──
  //   처음 누른 사람이 방장이 되어 방을 대기 상태로 되돌린다 (예전엔 전원을 데리고 바로 시작해서
  //   '게임 종료'를 누른 사람도 끌려 들어갔다). 다른 사람은 '참가하기'로 들어온다.
  if (action === "restart") {
    if (room.status !== "finished") return fail("이미 다시하기가 시작됐어요. '참가하기'를 눌러 주세요.", 409);
    const me = room.players.find((player) => player.id === memberId);
    if (!me) return fail("방에 들어가 있지 않습니다.");
    const other = await inOtherRoom(admin, memberId);
    if (other && other !== room.id) return fail("이미 다른 캐치마인드 방에 들어가 있습니다.");
    const ok = await updateIfUnchanged(admin, TABLE, room, {
      status: "waiting",
      host_member: me.id,
      host_name: me.name,
      players: [me],
      scores: {},
      turn_no: 0,
      turn_total: 0,
      play_no: (room.play_no ?? 0) + 1, // 몇 번째 판인지 (그림 기록이 이전 판과 겹치지 않게)
      drawer_member: null,
      drawer_name: null,
      phase: null,
      phase_deadline: null,
      hint: null,
      reveal_word: null,
      last_winner: null,
    });
    if (!ok) return fail("이미 다시하기가 시작됐어요. '참가하기'를 눌러 주세요.", 409);
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
    if (ok) {
      // 정답 기록 (그림 저장과 별개 · 게임 1등 메달 🎨 집계용). 실패해도 게임은 계속.
      const { error: logError } = await admin.from("catch_correct").insert({
        room_id: room.id,
        play_no: room.play_no ?? 0,
        turn_no: room.turn_no,
        member_id: memberId,
        name: me?.name ?? "",
        word: secret.word,
        is_test: Boolean(room.is_test),
      });
      if (logError) console.error("catch_correct insert", logError.message);
    }
    return NextResponse.json({ ok: true, correct: ok });
  }

  return fail("알 수 없는 요청입니다.");
}
