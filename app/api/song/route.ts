import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, loadPlayer, requireMemberId, updateIfUnchanged, type Admin } from "../../../lib/gameServer";
import { eraSupported, pickSongs } from "../../../lib/songPick";
import {
  INTRO_SECONDS,
  MAX_PLAYERS,
  REVEAL_SECONDS,
  SONG_COUNTS,
  STAGES,
  TICKETS_PER_SONG,
  cleanTitle,
  hintTitle,
  maskTitle,
  norm,
  parseEra,
  stagePoints,
} from "../../../lib/songQuiz";

/*
 * 🎧 노래 맞추기 API (카톡 !노래퀴즈 와 같은 규칙 · 방 + 여러 곡 연속)
 *  · 방장이 시작 → 곡을 골라 song_secrets 에 넣고 escrow → 봇이 이용 시간 · 티켓(곡당 2장, 운영진 무료) 확인 후 playing
 *  · 곡마다 2·4·6초 듣기 → 가수 힌트 → 제목 힌트. 시간 진행은 화면이 tick 으로 부르고 서버가 판단한다
 *  · 정답 → song_awards(pending) → 봇이 카톡 점수판에 지급 · !노래전적 합산
 *  · 끝나거나 모두 나가면 → 봇이 못 낸 곡 몫 티켓 반환
 *  · 음원은 서버가 받아서 준다 (애플 주소를 화면에 주면 곡 번호로 정답을 알 수 있어서)
 */

export const maxDuration = 30;

const TABLE = "song_rooms";
const GRACE_MS = 1500;
const ESCROW_WAIT_MS = 2 * 60 * 1000; // 봇이 이만큼 처리하지 못하면 대기로 되돌린다
const RECRUIT_COOLDOWN_MS = 60 * 1000;
const TOPIC_MAX = 20;

type Player = { id: string; name: string; uid: string | null };

type Room = {
  id: string;
  status: "waiting" | "escrow" | "playing" | "finished" | "cancelled";
  host_member: string;
  host_name: string;
  players: Player[];
  max_players: number;
  topic: string;
  song_total: number;
  song_no: number;
  songs_played: number;
  stage: number;
  phase: "intro" | "listen" | "reveal" | null;
  phase_deadline: string | null;
  scores: Record<string, number>;
  escrow_state: "none" | "requested" | "locked" | "failed";
  refund_state: "none" | "done";
  is_test: boolean;
  recruit_at: string | null;
  recruit_no: number;
  play_no: number;
  created_at: string;
  updated_at: string;
};

type Secret = { title: string; artist: string; year: string | null; preview: string; artwork: string | null; answers: string[] };

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadRoom(admin: Admin, id: string) {
  const { data } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as Room | null) ?? null;
}

async function loadSecret(admin: Admin, room: Room, songNo = room.song_no) {
  const { data } = await admin
    .from("song_secrets")
    .select("title,artist,year,preview,artwork,answers")
    .eq("room_id", room.id)
    .eq("play_no", room.play_no)
    .eq("song_no", songNo)
    .maybeSingle();
  return (data as Secret | null) ?? null;
}

// 유령 방 정리
async function cleanupStale(admin: Admin) {
  const now = Date.now();
  const stamp = new Date().toISOString();
  // 30분 동안 시작하지 않은 대기방
  await admin.from(TABLE).update({ status: "cancelled", updated_at: stamp }).eq("status", "waiting").lt("updated_at", new Date(now - 30 * 60 * 1000).toISOString());
  // 모두 떠나 아무도 진행시키지 않는 방 → 끝 (봇이 못 낸 곡 몫 티켓을 돌려준다)
  await admin.from(TABLE).update({ status: "finished", phase: null, phase_deadline: null, updated_at: stamp }).eq("status", "playing").lt("updated_at", new Date(now - 5 * 60 * 1000).toISOString());
  // 봇이 처리하지 못한 시작 요청 → 대기로 (봇이 잡은 locked 는 건드리지 않는다)
  await admin
    .from(TABLE)
    .update({ status: "waiting", escrow_state: "failed", reject_reason: "봇이 응답하지 않아요. 잠시 후 다시 시작해 주세요.", updated_at: stamp })
    .eq("status", "escrow")
    .eq("escrow_state", "requested")
    .lt("updated_at", new Date(now - ESCROW_WAIT_MS).toISOString());
}

async function myRooms(admin: Admin, memberId: string) {
  const { data, error } = await admin
    .from(TABLE)
    .select("id,players,status,is_test,created_at")
    .in("status", ["waiting", "escrow", "playing"])
    .contains("players", JSON.stringify([{ id: memberId }]))
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`방 조회 실패: ${error.message}`);
  return (data ?? []) as Array<{ id: string; players: Player[]; status: string; is_test: boolean }>;
}

// 참가자 정보 (카톡 점수판 user_id 가 있어야 점수를 받는다)
async function playerOf(admin: Admin, memberId: string): Promise<Player | { error: string; status: number }> {
  const member = await loadMember(admin, memberId);
  if ("error" in member) return member;
  const point = await loadPlayer(admin, memberId);
  return { id: member.id, name: member.name, uid: "error" in point ? null : point.uid };
}

// 다음 곡 (다 냈으면 끝)
function nextSong(room: Room, songNo: number): Record<string, unknown> {
  if (songNo >= room.song_total) {
    return { status: "finished", phase: null, phase_deadline: null };
  }
  return {
    song_no: songNo,
    songs_played: Math.max(room.songs_played, songNo + 1),
    stage: 0,
    phase: "listen",
    phase_deadline: later(STAGES[0].seconds),
    hint_artist: null,
    hint_title: null,
    reveal_title: null,
    reveal_artist: null,
    reveal_art: null,
    last_winner: null,
    last_points: null,
  };
}

async function reveal(admin: Admin, room: Room, fields: Record<string, unknown>) {
  const secret = await loadSecret(admin, room);
  return updateIfUnchanged(admin, TABLE, room, {
    phase: "reveal",
    phase_deadline: later(REVEAL_SECONDS),
    reveal_title: secret ? cleanTitle(secret.title) : "",
    reveal_artist: secret?.artist ?? "",
    reveal_art: secret?.artwork ?? null,
    ...fields,
  });
}

// 시간이 지난 단계를 다음으로 넘긴다
async function advance(admin: Admin, room: Room) {
  if (room.status !== "playing" || !room.phase_deadline) return false;
  if (Date.now() < new Date(room.phase_deadline).getTime() + GRACE_MS) return false;
  if (room.phase === "intro") return updateIfUnchanged(admin, TABLE, room, nextSong(room, room.song_no));
  if (room.phase === "reveal") return updateIfUnchanged(admin, TABLE, room, nextSong(room, room.song_no + 1));
  // 듣기 단계 → 다음 힌트, 마지막 힌트까지 지나면 정답 공개
  const stage = room.stage + 1;
  if (stage >= STAGES.length) return reveal(admin, room, { last_winner: null, last_points: null });
  const fields: Record<string, unknown> = { stage, phase_deadline: later(STAGES[stage].seconds) };
  if (STAGES[stage].hint) {
    const secret = await loadSecret(admin, room);
    if (secret && STAGES[stage].hint === "artist") fields.hint_artist = `${maskTitle(secret.artist)}${secret.year ? ` · ${secret.year}년` : ""}`;
    if (secret && STAGES[stage].hint === "title") fields.hint_title = maskTitle(hintTitle(secret.title));
  }
  return updateIfUnchanged(admin, TABLE, room, fields);
}

// 곡이 끝났는지 (끝난 방 · 다시하기 전 정리용)
const songsPlayedNow = (room: Room) => (room.status === "playing" && room.phase !== "intro" ? Math.max(room.songs_played, room.song_no + 1) : room.songs_played);

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

  const [auth, loaded] = await Promise.all([requireMemberId(request, admin), roomId ? loadRoom(admin, roomId) : Promise.resolve(null)]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;
  if (action !== "audio" && action !== "tick") {
    console.log("[song]", action, "member", memberId.slice(0, 8), "room", roomId.slice(0, 8), loaded ? `${loaded.status}/${loaded.players.length}명` : "-");
  }

  if (action === "cleanup") {
    await cleanupStale(admin);
    return NextResponse.json({ ok: true });
  }

  if (action === "create" || action === "create_test") {
    const test = action === "create_test";
    if (test && !(await isAdminMember(admin, memberId))) return fail("관리자만 테스트할 수 있습니다.", 403);
    const player = await playerOf(admin, memberId);
    if ("error" in player) return fail(player.error, player.status);
    await cleanupStale(admin);
    const [current] = await myRooms(admin, memberId);
    if (current) {
      const aloneWaiting = current.status === "waiting" && current.players.length === 1 && current.players[0].id === memberId;
      if (!!current.is_test === test || !aloneWaiting) return NextResponse.json({ ok: true, id: current.id, existing: true });
      await admin.from(TABLE).update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", current.id);
    }
    const { data, error } = await admin
      .from(TABLE)
      .insert({ host_member: memberId, host_name: player.name, players: [player], max_players: MAX_PLAYERS, is_test: test })
      .select("id")
      .single();
    if (error) {
      const missing = /song_rooms/.test(error.message) && /exist|schema cache/i.test(error.message);
      return fail(missing ? "노래 맞추기 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)" : `만들기 실패: ${error.message}`, 500);
    }
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (!roomId) return fail("방 정보가 없습니다.");
  const room = loaded;
  if (!room) return fail("방을 찾지 못했습니다.", 404);
  const inRoom = room.players.some((player) => player.id === memberId);

  // 🔊 음원 (관전자도 들을 수 있다). 준비 · 듣기 · 정답 공개 때 지금 곡만
  if (action === "audio") {
    if (room.status !== "playing" || !room.phase) return fail("지금은 들을 곡이 없습니다.", 409);
    if (Number(body?.songNo) !== room.song_no) return fail("곡이 바뀌었어요.", 409);
    const secret = await loadSecret(admin, room);
    if (!secret) return fail("곡을 찾지 못했습니다.", 404);
    try {
      const response = await fetch(secret.preview, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return fail(`음원을 받지 못했습니다. (${response.status})`, 502);
      const bytes = await response.arrayBuffer();
      return new Response(bytes, {
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "audio/mp4",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (error) {
      return fail(`음원을 받지 못했습니다. (${String(error).slice(0, 60)})`, 502);
    }
  }

  if (action === "tick") {
    const changed = await advance(admin, room);
    return NextResponse.json({ ok: true, changed });
  }

  if (action === "join") {
    if (inRoom) return NextResponse.json({ ok: true });
    if (room.status !== "waiting" && room.status !== "playing" && room.status !== "escrow") return fail("끝난 방입니다.");
    if (room.players.length >= room.max_players) return fail(`방이 가득 찼습니다. (최대 ${room.max_players}명)`);
    const player = await playerOf(admin, memberId);
    if ("error" in player) return fail(player.error, player.status);
    const others = (await myRooms(admin, memberId)).filter((item) => item.id !== room.id);
    if (others.length > 0) return fail("이미 다른 노래 맞추기 방에 들어가 있습니다.");
    const fields: Record<string, unknown> = { players: [...room.players, player] };
    if (room.status === "playing") fields.scores = { ...room.scores, [player.id]: room.scores?.[player.id] ?? 0 };
    const ok = await updateIfUnchanged(admin, TABLE, room, fields);
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true, noPoints: !player.uid });
  }

  if (!inRoom) return fail("방에 들어가 있지 않습니다.");

  if (action === "leave") {
    if (room.status === "finished" || room.status === "cancelled") return NextResponse.json({ ok: true });
    if (room.status === "escrow" && room.host_member === memberId) return fail("티켓 확인 중입니다. 잠시만 기다려 주세요.");
    const players = room.players.filter((player) => player.id !== memberId);
    const hostFields = room.host_member === memberId && players[0] ? { host_member: players[0].id, host_name: players[0].name } : {};
    if (players.length === 0) {
      const ended = room.status === "playing" ? { status: "finished", songs_played: songsPlayedNow(room), phase: null, phase_deadline: null } : { status: "cancelled" };
      await updateIfUnchanged(admin, TABLE, room, { ...ended, players });
      return NextResponse.json({ ok: true });
    }
    const ok = await updateIfUnchanged(admin, TABLE, room, { ...hostFields, players });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // 대기 중 방장이 자리를 비웠을 때 넘겨받기
  if (action === "take_host") {
    if (room.status !== "waiting") return fail("대기 중일 때만 방장을 바꿀 수 있습니다.");
    if (room.host_member === memberId) return NextResponse.json({ ok: true });
    const me = room.players.find((player) => player.id === memberId)!;
    const ok = await updateIfUnchanged(admin, TABLE, room, { host_member: me.id, host_name: me.name });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "recruit") {
    if (room.is_test) return fail("테스트 방은 모집 알림을 보내지 않습니다.");
    if (room.status !== "waiting" && room.status !== "playing") return fail("끝난 방입니다.");
    if (room.players.length >= room.max_players) return fail("방이 이미 가득 찼습니다.");
    const last = room.recruit_at ? new Date(room.recruit_at).getTime() : 0;
    const wait = Math.ceil((last + RECRUIT_COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) return fail(`방금 모집 알림을 보냈어요. ${wait}초 뒤에 다시 보낼 수 있습니다.`);
    const ok = await updateIfUnchanged(admin, TABLE, room, { recruit_at: new Date().toISOString(), recruit_no: (room.recruit_no ?? 0) + 1 });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // 방장: 주제 · 곡 수
  if (action === "settings") {
    if (room.host_member !== memberId) return fail("방장만 바꿀 수 있습니다.");
    if (room.status !== "waiting") return fail("대기 중일 때만 바꿀 수 있습니다.");
    const topic = String(body?.topic ?? room.topic).trim().slice(0, TOPIC_MAX);
    const count = Number(body?.songTotal ?? room.song_total);
    if (!SONG_COUNTS.includes(count)) return fail("곡 수를 다시 골라 주세요.");
    const era = topic ? parseEra(topic) : null;
    if (era && !eraSupported(era[0], era[1])) return fail(`${era[2]}은(는) 지원하지 않습니다. 1990년대부터 고를 수 있어요.`);
    const ok = await updateIfUnchanged(admin, TABLE, room, { topic, song_total: count, reject_reason: null });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "start") {
    if (room.host_member !== memberId) return fail("방장만 시작할 수 있습니다.");
    if (room.status !== "waiting") return fail("이미 시작한 방입니다.");
    const host = room.players.find((player) => player.id === memberId);
    if (!room.is_test && !host?.uid) return fail("카톡 봇 점수판에서 방장님을 찾지 못했습니다. (닉네임 확인 · 티켓을 쓸 수 없어요)");
    // 최근에 낸 곡은 빼고 고른다
    const { data: recent } = await admin.from("song_secrets").select("track_id").order("created_at", { ascending: false }).limit(300);
    const songs = await pickSongs(room.topic, room.song_total, new Set((recent ?? []).map((row) => String(row.track_id))));
    if (songs.length < room.song_total) {
      return fail(
        songs.length === 0
          ? `'${room.topic || "K-POP"}'에서 낼 곡을 찾지 못했어요. 주제를 바꿔 보세요.`
          : `'${room.topic || "K-POP"}'에서 ${songs.length}곡만 찾았어요. 곡 수를 줄이거나 주제를 바꿔 보세요.`,
      );
    }
    const playNo = room.play_no ?? 0;
    await admin.from("song_secrets").delete().eq("room_id", room.id).eq("play_no", playNo);
    const { error } = await admin.from("song_secrets").insert(
      songs.map((song, index) => ({
        room_id: room.id,
        play_no: playNo,
        song_no: index,
        track_id: song.trackId,
        title: song.title,
        artist: song.artist,
        year: song.year,
        preview: song.preview,
        artwork: song.artwork,
        answers: song.answers,
      })),
    );
    if (error) return fail(`곡을 저장하지 못했습니다: ${error.message}`, 500);
    const scores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
    const common = { scores, song_no: 0, songs_played: 0, stage: 0, reject_reason: null, hint_artist: null, hint_title: null,
      reveal_title: null, reveal_artist: null, reveal_art: null, last_winner: null, last_points: null, cost: 0, refund_state: "none", announced: false };
    // 테스트 방은 티켓 · 점수 없이 바로 시작. 아니면 봇이 티켓을 확인한 뒤 시작한다
    const ok = room.is_test
      ? await updateIfUnchanged(admin, TABLE, room, { ...common, status: "playing", escrow_state: "none", phase: "intro", phase_deadline: later(INTRO_SECONDS) })
      : await updateIfUnchanged(admin, TABLE, room, { ...common, status: "escrow", escrow_state: "requested", phase: null, phase_deadline: null });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true, cost: room.is_test ? 0 : room.song_total * TICKETS_PER_SONG });
  }

  // 방장이 일찍 끝내기 (못 낸 곡 몫 티켓은 봇이 돌려준다)
  if (action === "end") {
    if (room.host_member !== memberId) return fail("방장만 끝낼 수 있습니다.");
    if (room.status !== "playing") return fail("진행 중인 방이 아닙니다.");
    const ok = await updateIfUnchanged(admin, TABLE, room, { status: "finished", songs_played: songsPlayedNow(room), phase: null, phase_deadline: null });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // 다시하기: 누른 사람이 방장이 되어 대기로 (정산이 끝난 뒤에만)
  if (action === "restart") {
    if (room.status !== "finished") return fail("이미 다시하기가 시작됐어요. '참가하기'를 눌러 주세요.", 409);
    if (room.escrow_state === "locked" && room.refund_state !== "done") return fail("점수 · 티켓 정리 중이에요. 몇 초 뒤에 다시 눌러 주세요.", 409);
    const me = room.players.find((player) => player.id === memberId)!;
    const others = (await myRooms(admin, memberId)).filter((item) => item.id !== room.id);
    if (others.length > 0) return fail("이미 다른 노래 맞추기 방에 들어가 있습니다.");
    const ok = await updateIfUnchanged(admin, TABLE, room, {
      status: "waiting",
      host_member: me.id,
      host_name: me.name,
      players: [me],
      scores: {},
      song_no: 0,
      songs_played: 0,
      stage: 0,
      phase: null,
      phase_deadline: null,
      play_no: (room.play_no ?? 0) + 1,
      escrow_state: "none",
      refund_state: "none",
      cost: 0,
      reject_reason: null,
      hint_artist: null,
      hint_title: null,
      reveal_title: null,
      reveal_artist: null,
      reveal_art: null,
      last_winner: null,
      last_points: null,
      announced: false,
    });
    if (!ok) return fail("이미 다시하기가 시작됐어요. '참가하기'를 눌러 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "guess") {
    if (room.status !== "playing" || room.phase !== "listen") return NextResponse.json({ ok: true, correct: false });
    if (room.phase_deadline && Date.now() > new Date(room.phase_deadline).getTime() + GRACE_MS) {
      await advance(admin, room);
      return NextResponse.json({ ok: true, correct: false });
    }
    const text = norm(String(body?.text ?? "").slice(0, 60));
    if (!text) return NextResponse.json({ ok: true, correct: false });
    const secret = await loadSecret(admin, room);
    if (!secret || !(secret.answers ?? []).includes(text)) return NextResponse.json({ ok: true, correct: false });
    const me = room.players.find((player) => player.id === memberId)!;
    const points = stagePoints(room.stage);
    const scores = { ...room.scores, [memberId]: (room.scores?.[memberId] ?? 0) + points };
    const ok = await reveal(admin, room, { scores, last_winner: me.name, last_points: points });
    if (ok && !room.is_test) {
      // 카톡 점수판 지급은 봇이 한다 (점수판에 없는 사람은 건너뛴다)
      const { error } = await admin.from("song_awards").insert({
        room_id: room.id,
        play_no: room.play_no ?? 0,
        song_no: room.song_no,
        member_id: memberId,
        name: me.name,
        uid: me.uid,
        points,
        title: cleanTitle(secret.title),
        artist: secret.artist,
        stage: room.stage,
        state: me.uid ? "pending" : "skipped",
        note: me.uid ? null : "카톡 점수판에 없음",
      });
      if (error) console.error("song_awards insert", error.message);
    }
    return NextResponse.json({ ok: true, correct: ok, points });
  }

  return fail("알 수 없는 요청입니다.");
}
