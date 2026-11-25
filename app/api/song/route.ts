import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, isAdminMember, loadMember, loadPlayer, requireMemberId, updateIfUnchanged, type Admin } from "../../../lib/gameServer";
import { eraSupported, pickSongs } from "../../../lib/songPick";
import {
  DAILY_POINT_CAP,
  kstDayStartIso,
  REVEAL_SECONDS,
  STAGES,
  TICKETS_PER_SONG,
  cleanTitle,
  hintTitle,
  maskTitle,
  norm,
  parseEra,
  stagePoints,
  type SongMode,
} from "../../../lib/songQuiz";

/*
 * 🎧 노래 맞추기 API — 늘 열려 있는 방 하나 (2026-11-24)
 *  · 방장 없음. 아무나 들어와 주제 · 전주/하이라이트를 골라 '출제' → 한 번에 1곡
 *  · 출제 → 곡을 골라 song_secrets 에 넣고 escrow → 봇이 이용 시간 · 티켓(2장, 운영진 무료) 확인
 *      전주면 봇 폰이 원곡 앞부분을 잘라 song-clips 저장소에 올린 뒤 playing (못 구하면 하이라이트로)
 *  · 2·4·6초 듣기 → 가수 힌트 → 제목 힌트. 시간 진행은 화면이 tick 으로 부르고 서버가 판단한다
 *  · 정답 → song_awards(pending) → 봇이 카톡 점수판에 지급 · !노래전적 합산
 *  · 정답 공개가 끝나면 다시 대기 → 누구든 다음 곡 출제
 *  · 음원은 서버가 받아서 준다 (애플 주소 · 유튜브 번호를 화면에 주면 정답을 알 수 있어서)
 */

export const maxDuration = 60; // 시대별 선곡은 애플 검색을 여러 번 해서 20초 가까이 걸린다

const TABLE = "song_rooms";
const GRACE_MS = 1500;
const ESCROW_WAIT_MS = 90 * 1000; // 봇이 이만큼 처리하지 못하면 대기로 되돌린다
const RECRUIT_COOLDOWN_MS = 60 * 1000;
const TOPIC_MAX = 20;
const BUCKET = "song-clips";

type Room = {
  id: string;
  status: "waiting" | "escrow" | "playing" | "finished" | "cancelled";
  is_lobby: boolean;
  mode: SongMode;
  topic: string;
  song_no: number;
  stage: number;
  phase: "intro" | "listen" | "reveal" | null;
  phase_deadline: string | null;
  opener_member: string | null;
  opener_name: string | null;
  escrow_state: "none" | "requested" | "locked" | "failed";
  recruit_at: string | null;
  recruit_no: number;
  play_no: number;
  updated_at: string;
};

type Secret = {
  title: string;
  artist: string;
  year: string | null;
  preview: string;
  artwork: string | null;
  answers: string[];
  mode: SongMode;
  clip_path: string | null;
};

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const IDLE = { status: "waiting", phase: null, phase_deadline: null } as const;

async function loadLobby(admin: Admin) {
  const { data } = await admin.from(TABLE).select("*").eq("is_lobby", true).maybeSingle();
  if (data) return data as Room;
  // 처음이면 만든다 (동시에 만들면 하나만 남고 다른 쪽은 다시 읽는다)
  const host = await admin.from("members").select("id,name").eq("active", true).limit(1).maybeSingle();
  if (!host.data) return null;
  await admin
    .from(TABLE)
    .insert({ is_lobby: true, host_member: host.data.id, host_name: "모두", players: [], max_players: 0, song_total: 1, status: "waiting" });
  const again = await admin.from(TABLE).select("*").eq("is_lobby", true).maybeSingle();
  return (again.data as Room | null) ?? null;
}

async function loadSecret(admin: Admin, room: Room) {
  const { data } = await admin
    .from("song_secrets")
    .select("title,artist,year,preview,artwork,answers,mode,clip_path")
    .eq("room_id", room.id)
    .eq("play_no", room.play_no)
    .eq("song_no", 0)
    .maybeSingle();
  return (data as Secret | null) ?? null;
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

// 시간이 지난 단계를 다음으로 넘긴다 (봇이 멈춘 출제도 여기서 되돌린다)
async function advance(admin: Admin, room: Room) {
  // 곡 고르다 멈춘 것(none)도, 봇이 처리 못 한 것(requested)도. 봇이 잡은 것(locked)은 봇이 끝낸다
  if (room.status === "escrow" && room.escrow_state !== "locked" && Date.now() - new Date(room.updated_at).getTime() > ESCROW_WAIT_MS) {
    return updateIfUnchanged(admin, TABLE, room, { ...IDLE, escrow_state: "failed", notice: "⚠️ 봇이 응답하지 않아 출제를 취소했어요. 잠시 후 다시 해 주세요." });
  }
  if (room.status !== "playing" || !room.phase_deadline) return false;
  if (Date.now() < new Date(room.phase_deadline).getTime() + GRACE_MS) return false;
  if (room.phase === "intro") {
    return updateIfUnchanged(admin, TABLE, room, { stage: 0, phase: "listen", phase_deadline: later(STAGES[0].seconds) });
  }
  if (room.phase === "reveal") return updateIfUnchanged(admin, TABLE, room, { ...IDLE });
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

export async function POST(request: Request) {
  let admin: Admin;
  try {
    admin = getServerAdmin();
  } catch {
    return fail("서버 설정 오류", 500);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;

  const room = await loadLobby(admin);
  if (!room) return fail("노래 맞추기 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)", 500);
  if (action !== "audio" && action !== "tick") {
    console.log("[song]", action, "member", memberId.slice(0, 8), room.status, room.phase ?? "-");
  }

  if (action === "lobby") return NextResponse.json({ ok: true, id: room.id });

  if (action === "tick") {
    const changed = await advance(admin, room);
    return NextResponse.json({ ok: true, changed });
  }

  // 🔊 음원: clip = 문제 (전주 조각 또는 미리듣기), full = 정답 공개 때 하이라이트
  if (action === "audio") {
    if (room.status !== "playing" || !room.phase) return fail("지금은 들을 곡이 없습니다.", 409);
    if (Number(body?.playNo) !== room.play_no) return fail("곡이 바뀌었어요.", 409);
    const kind = body?.kind === "full" ? "full" : "clip";
    if (kind === "full" && room.phase !== "reveal") return fail("정답 공개 때만 들을 수 있어요.", 403);
    const secret = await loadSecret(admin, room);
    if (!secret) return fail("곡을 찾지 못했습니다.", 404);
    try {
      if (kind === "clip" && secret.mode === "intro" && secret.clip_path) {
        const { data, error } = await admin.storage.from(BUCKET).download(secret.clip_path);
        if (error || !data) return fail(`전주를 받지 못했습니다. (${error?.message ?? "없음"})`, 502);
        return new Response(await data.arrayBuffer(), { headers: { "Content-Type": "audio/mp4", "Cache-Control": "private, no-store" } });
      }
      const response = await fetch(secret.preview, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return fail(`음원을 받지 못했습니다. (${response.status})`, 502);
      return new Response(await response.arrayBuffer(), {
        headers: { "Content-Type": response.headers.get("content-type") ?? "audio/mp4", "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      return fail(`음원을 받지 못했습니다. (${String(error).slice(0, 60)})`, 502);
    }
  }

  // 🎵 출제 (아무나 · 대기 중일 때)
  if (action === "ask") {
    if (room.status !== "waiting") return fail(room.status === "escrow" ? "다른 분이 출제 중이에요." : "지금 문제가 진행 중이에요. 끝나면 출제할 수 있어요.", 409);
    const topic = String(body?.topic ?? "").trim().slice(0, TOPIC_MAX);
    const mode: SongMode = body?.mode === "intro" ? "intro" : "highlight";
    const era = topic ? parseEra(topic) : null;
    if (era && !eraSupported(era[0], era[1])) return fail(`${era[2]}은(는) 지원하지 않습니다. 1990년대부터 고를 수 있어요.`);
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    const point = await loadPlayer(admin, memberId);
    if ("error" in point) return fail("카톡 봇 점수판에서 회원님을 찾지 못했어요. (닉네임 확인 · 티켓을 쓸 수 없어요)");
    // 다른 사람이 먼저 누르지 않았는지 선점 (출제 중으로 바꾼 뒤 곡을 고른다)
    const playNo = (room.play_no ?? 0) + 1;
    const claimed = await updateIfUnchanged(admin, TABLE, room, {
      status: "escrow",
      escrow_state: "none",
      play_no: playNo,
      mode,
      topic,
      opener_member: member.id,
      opener_name: member.name,
      opener_uid: point.uid,
      notice: null,
      reject_reason: null,
      song_no: 0,
      song_total: 1,
      stage: 0,
      phase: null,
      phase_deadline: null,
      hint_artist: null,
      hint_title: null,
      reveal_title: null,
      reveal_artist: null,
      reveal_art: null,
      last_winner: null,
      last_points: null,
      cost: 0,
    });
    if (!claimed) return fail("다른 분이 먼저 출제했어요.", 409);
    const fresh = (await admin.from(TABLE).select("*").eq("id", room.id).single()).data as Room;
    const { data: recent } = await admin.from("song_secrets").select("track_id").order("created_at", { ascending: false }).limit(300);
    const [song] = await pickSongs(topic, 1, new Set((recent ?? []).map((row) => String(row.track_id))));
    if (!song) {
      await updateIfUnchanged(admin, TABLE, fresh, { ...IDLE });
      return fail(`'${topic || "K-POP"}'에서 낼 곡을 찾지 못했어요. 주제를 바꿔 보세요.`);
    }
    const { error } = await admin.from("song_secrets").upsert({
      room_id: room.id,
      play_no: playNo,
      song_no: 0,
      track_id: song.trackId,
      title: song.title,
      artist: song.artist,
      year: song.year,
      preview: song.preview,
      artwork: song.artwork,
      answers: song.answers,
      mode,
      duration_ms: song.durationMs,
      clip_path: null,
    });
    if (error) {
      await updateIfUnchanged(admin, TABLE, fresh, { ...IDLE });
      return fail(`곡을 저장하지 못했습니다: ${error.message}`, 500);
    }
    // 이제 봇이 티켓을 확인한다 (전주면 앞부분도 준비)
    const ok = await updateIfUnchanged(admin, TABLE, fresh, { escrow_state: "requested" });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true, cost: TICKETS_PER_SONG });
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
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    // 하루 상한: 오늘 이미 받은(또는 지급 대기) 점수를 빼고 남은 만큼만
    const { data: todayRows } = await admin
      .from("song_awards")
      .select("points")
      .eq("member_id", memberId)
      .in("state", ["pending", "paid"])
      .gte("created_at", kstDayStartIso())
      .limit(500);
    const already = (todayRows ?? []).reduce((sum, row) => sum + Number(row.points ?? 0), 0);
    const points = Math.max(0, Math.min(stagePoints(room.stage), DAILY_POINT_CAP - already));
    const ok = await reveal(admin, room, { last_winner: member.name, last_points: points });
    if (ok) {
      const point = await loadPlayer(admin, memberId);
      const uid = "error" in point ? null : point.uid;
      const { error } = await admin.from("song_awards").insert({
        room_id: room.id,
        play_no: room.play_no,
        song_no: 0,
        member_id: memberId,
        name: member.name,
        uid,
        points,
        title: cleanTitle(secret.title),
        artist: secret.artist,
        stage: room.stage,
        state: uid ? "pending" : "skipped",
        note: uid ? null : "카톡 점수판에 없음",
      });
      if (error) console.error("song_awards insert", error.message);
    }
    return NextResponse.json({ ok: true, correct: ok, points });
  }

  // ⏭ 정답 공개 (출제자 · 운영진) — 티켓은 돌려주지 않는다
  if (action === "skip") {
    if (room.status !== "playing" || (room.phase !== "listen" && room.phase !== "intro")) return fail("지금은 넘길 문제가 없어요.");
    if (room.opener_member !== memberId && !(await isAdminMember(admin, memberId))) return fail("출제자와 운영진만 넘길 수 있어요.");
    const ok = await reveal(admin, room, { last_winner: null, last_points: null });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  // 📣 카톡방에 모집 알림 (봇이 올린다)
  if (action === "recruit") {
    const last = room.recruit_at ? new Date(room.recruit_at).getTime() : 0;
    const wait = Math.ceil((last + RECRUIT_COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) return fail(`방금 모집 알림을 보냈어요. ${wait}초 뒤에 다시 보낼 수 있습니다.`);
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    const ok = await updateIfUnchanged(admin, TABLE, room, {
      recruit_at: new Date().toISOString(),
      recruit_no: (room.recruit_no ?? 0) + 1,
      host_name: member.name, // 누가 모집했는지 (알림에 쓴다)
    });
    if (!ok) return fail("잠시 후 다시 시도해 주세요.", 409);
    return NextResponse.json({ ok: true });
  }

  return fail("알 수 없는 요청입니다.");
}
