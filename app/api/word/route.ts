import { NextResponse } from "next/server";
import { getServerAdmin } from "../../../lib/server-admin";
import { fail, loadMember, loadPlayer, requestInvite, requireMemberId } from "../../../lib/gameServer";
import {
  KEYS,
  REWARDS,
  TICKET_PRICE,
  WORD_GAME_COLUMNS,
  WORD_LEN,
  checkGuess,
  composeWords,
  type WordGameRow,
} from "../../../lib/wordGame";

/*
 * 단어게임 API (모든 쓰기는 여기서만)
 *  · start  → word_games(escrow) → 봇이 티켓 1장(없으면 50점 자동구매) 차감 · 정답을 word_secrets 에 넣고 playing
 *  · guess  → 단어장(word_dict)에 있는 단어만. 처음 보는 단어는 valid=null 로 넣고 봇이 AI 로 검증한다 (pending)
 *  · 끝나면 won · lost + answer → 봇이 보상(1번 300 · 2번 150 · 3번 90 · 4번 50 · 5번 30점) 지급 · 카톡 전적에 합산
 */

const ESCROW_CANCEL_MS = 60 * 1000; // 봇이 이만큼 처리 못 하면 취소할 수 있다
const PENDING_MAX = 30; // AI 검증 대기 단어가 이보다 많으면 잠시 막는다

async function readGame(admin: ReturnType<typeof getServerAdmin>, id: string, memberId: string) {
  const { data } = await admin.from("word_games").select(`${WORD_GAME_COLUMNS},updated_at`).eq("id", id).maybeSingle();
  if (!data || data.member_id !== memberId) return null;
  return data as unknown as WordGameRow & { updated_at: string };
}

export async function POST(request: Request) {
  const admin = getServerAdmin();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const gameId = typeof body.gameId === "string" ? body.gameId : "";

  const auth = await requireMemberId(request, admin);
  if ("error" in auth) return fail(auth.error, auth.status);
  const memberId = auth.memberId;

  if (action === "start") {
    const { data: active } = await admin
      .from("word_games")
      .select("id")
      .eq("member_id", memberId)
      .in("status", ["escrow", "playing"])
      .limit(1);
    if (active?.[0]) return NextResponse.json({ ok: true, id: active[0].id });
    const player = await loadPlayer(admin, memberId);
    if ("error" in player) return fail(player.error, player.status);
    if (player.tickets < 1 && player.exp < TICKET_PRICE) {
      return fail(`티켓이 없고, 자동 구매할 ${TICKET_PRICE}점도 부족합니다. (지금 ${player.exp.toLocaleString("ko-KR")}점)`);
    }
    const { data, error } = await admin
      .from("word_games")
      .insert({ member_id: memberId, name: player.name, uid: player.uid })
      .select("id")
      .single();
    if (error) return fail(`시작하지 못했습니다: ${error.message}`);
    return NextResponse.json({ ok: true, id: data.id });
  }

  // 💬 채팅 (관전자도): 저장해 두어 나중에 다시 열어도 보인다
  if (action === "chat") {
    const text = String(body.text ?? "").trim().slice(0, 80);
    if (!text || !gameId) return fail("채팅 내용을 입력해 주세요.");
    const member = await loadMember(admin, memberId);
    if ("error" in member) return fail(member.error, member.status);
    const { data: exists } = await admin.from("word_games").select("id").eq("id", gameId).maybeSingle();
    if (!exists) return fail("게임을 찾지 못했습니다.", 404);
    const { data: last } = await admin
      .from("word_chat")
      .select("created_at")
      .eq("game_id", gameId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (last?.[0] && Date.now() - new Date(last[0].created_at as string).getTime() < 700) return fail("조금 천천히 보내 주세요.");
    const { data, error } = await admin
      .from("word_chat")
      .insert({ game_id: gameId, member_id: memberId, name: member.name, text })
      .select("id")
      .single();
    if (error) return fail(`채팅을 저장하지 못했어요: ${error.message}`);
    return NextResponse.json({ ok: true, chatId: data.id });
  }

  const game = gameId ? await readGame(admin, gameId, memberId) : null;
  if (!game) return fail("게임을 찾지 못했습니다.", 404);

  // 🆘 도움! → 카톡방에 알림 (봇이 올린다, 1분에 한 번)
  if (action === "help") {
    if (game.status !== "playing") return fail("진행 중인 게임에서만 도움을 요청할 수 있어요.");
    const result = await requestInvite(admin, "word", game.id, memberId);
    if (result.ok) return NextResponse.json({ ok: true });
    if (result.error.includes("check constraint")) {
      return fail("카톡 알림 설정이 아직 안 됐어요. (운영진: 단어게임 도움 SQL 실행 필요)");
    }
    return fail(result.error);
  }

  // 도움 요청이 카톡방에 올라갔는지 (봇이 보내면 sent_at 이 찬다)
  if (action === "helpStatus") {
    const { data } = await admin
      .from("bot_announcements")
      .select("sent_at")
      .eq("ref_id", game.id)
      .eq("kind", "word")
      .order("created_at", { ascending: false })
      .limit(1);
    return NextResponse.json({ ok: true, sent: !!data?.[0]?.sent_at });
  }

  if (action === "quit") {
    const now = new Date().toISOString();
    if (game.status === "escrow") {
      if (Date.now() - new Date(game.created_at).getTime() < ESCROW_CANCEL_MS) return fail("티켓 확인 중입니다. 잠시만 기다려 주세요.");
      const { data } = await admin
        .from("word_games")
        .update({ status: "rejected", escrow_state: "failed", reject_reason: "취소", updated_at: now })
        .eq("id", game.id)
        .eq("escrow_state", "requested")
        .select("id");
      return (data ?? []).length ? NextResponse.json({ ok: true }) : fail("이미 시작되었습니다. 새로고침해 주세요.");
    }
    if (game.status !== "playing") return NextResponse.json({ ok: true });
    const { data: secret } = await admin.from("word_secrets").select("target").eq("game_id", game.id).maybeSingle();
    await admin
      .from("word_games")
      .update({ status: "lost", answer: secret?.target ?? null, finished_at: now, updated_at: now })
      .eq("id", game.id)
      .eq("status", "playing");
    return NextResponse.json({ ok: true });
  }

  if (action === "guess") {
    if (game.status !== "playing") return fail("진행 중인 게임이 아닙니다.");
    const jamo = Array.isArray(body.jamo) ? body.jamo.map(String) : [];
    if (jamo.length !== WORD_LEN || !jamo.every((j) => KEYS.has(j))) return fail(`자모 ${WORD_LEN}개를 입력해 주세요.`);
    const { data: secret } = await admin.from("word_secrets").select("target,target_jamo").eq("game_id", game.id).maybeSingle();
    if (!secret) return fail("정답을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.");
    const key = jamo.join("");
    const correct = key === secret.target_jamo;

    if (!correct) {
      const { data: known } = await admin.from("word_dict").select("word,valid").eq("jamo", key);
      const rows = (known ?? []) as Array<{ word: string; valid: boolean | null }>;
      if (!rows.some((r) => r.valid === true)) {
        const words = composeWords(jamo);
        if (words.length === 0) return fail("글자를 만들 수 없는 자모 조합이에요. (기회 차감 없음)");
        const fresh = words.filter((w) => !rows.some((r) => r.word === w));
        if (fresh.length) {
          const { count } = await admin.from("word_dict").select("word", { count: "exact", head: true }).is("valid", null);
          if ((count ?? 0) >= PENDING_MAX) return fail("AI 검증할 단어가 밀려 있어요. 잠시 뒤 다시 입력해 주세요. (기회 차감 없음)");
          await admin.from("word_dict").upsert(
            fresh.map((word) => ({ word, jamo: key, valid: null })),
            { onConflict: "word", ignoreDuplicates: true },
          );
        }
        if (fresh.length || rows.some((r) => r.valid === null)) {
          return NextResponse.json({ ok: false, pending: true, words, error: `'${words.join(" · ")}' AI 검증 중…` });
        }
        return fail(`'${words.join(" · ")}'(은)는 게임에 쓸 수 없는 단어예요. (기회 차감 없음)`);
      }
    }

    const tries = game.tries + 1;
    const history = [...game.history, { jamo, result: checkGuess(secret.target_jamo.split(""), jamo) }];
    const now = new Date().toISOString();
    const done = correct || tries >= game.max_tries;
    const { data: saved } = await admin
      .from("word_games")
      .update({
        history,
        tries,
        updated_at: now,
        ...(done
          ? { status: correct ? "won" : "lost", answer: secret.target, reward: correct ? REWARDS[tries] ?? 0 : 0, finished_at: now }
          : {}),
      })
      .eq("id", game.id)
      .eq("status", "playing")
      .eq("tries", game.tries)
      .select(WORD_GAME_COLUMNS);
    if (!saved?.length) return fail("다른 화면에서 이미 입력했어요. 새로고침해 주세요.");
    return NextResponse.json({ ok: true, game: saved[0] });
  }

  return fail("알 수 없는 요청입니다.");
}
