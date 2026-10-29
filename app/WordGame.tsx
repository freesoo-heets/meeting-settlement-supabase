"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  KEY_ROWS,
  MAX_TRIES,
  QWERTY,
  REWARDS,
  TICKET_PRICE,
  WORD_GAME_COLUMNS,
  WORD_LEN,
  composeWords,
  type Mark,
  type WordGameRow,
} from "../lib/wordGame";

type Props = {
  onClose: () => void;
  onBack: () => void;
  currentMemberId: string;
  myName: string;
  myPoints: number | null;
  myTickets: number | null;
  initialGameId?: string; // 다른 사람 판을 관전할 때
};

type ChatLine = { key: number; id?: string; at?: string; name: string; text: string; kind?: "sys" | "me" };
type ChatRow = { id: string; member_id: string; name: string; text: string; created_at: string };

type CallResult = { ok: boolean; error?: string; id?: string; pending?: boolean; game?: WordGameRow };

async function callWord(payload: Record<string, unknown>): Promise<CallResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/word", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as CallResult;
}

const fmt = (n: number) => n.toLocaleString("ko-KR");
const RANK: Record<Mark, number> = { x: 1, y: 2, g: 3 };
const PENDING_RETRY_MS = 2500;
const PENDING_MAX_RETRY = 14;
const CHAT_MAX = 60;

// 채팅 입력칸 등에 쓰는 중이면 게임 자판으로 가로채지 않는다
const isTypingField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function chatTime(value: string) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function shortDate(value: string) {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function WordGame({ onClose, onBack, currentMemberId, myName, myPoints, myTickets, initialGameId }: Props) {
  const [games, setGames] = useState<WordGameRow[]>([]);
  const [game, setGame] = useState<WordGameRow | null>(null);
  const [typed, setTyped] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [menu, setMenu] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoNote, setAutoNote] = useState(false); // 🎫 자동 구매 안내: 시작할 때 잠깐만
  const retry = useRef<{ key: string; count: number; timer: ReturnType<typeof setTimeout> | null }>({ key: "", count: 0, timer: null });
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatText, setChatText] = useState("");
  // 채팅 입력 중(휴대폰 키보드가 올라옴): 판을 줄이고 자모 자판 · 도움 버튼을 잠깐 숨긴다
  const [chatting, setChatting] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);
  const [viewers, setViewers] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const chatKey = useRef(0);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const spectating = !!game && game.member_id !== currentMemberId;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("word_games")
      .select(WORD_GAME_COLUMNS)
      .eq("member_id", currentMemberId)
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = (data ?? []) as unknown as WordGameRow[];
    setGames(rows);
    setLoaded(true);
    return rows;
  }, [currentMemberId]);

  // 처음: 관전할 판 · 아니면 내가 하던 판 이어서
  useEffect(() => {
    void load().then(async (rows) => {
      if (initialGameId) {
        const { data } = await supabase.from("word_games").select(WORD_GAME_COLUMNS).eq("id", initialGameId).maybeSingle();
        if (data) return setGame(data as unknown as WordGameRow);
      }
      const live = rows.find((r) => r.status === "escrow" || r.status === "playing");
      if (live) setGame(live);
    });
  }, [load, initialGameId]);

  const addChat = useCallback((line: Omit<ChatLine, "key">) => {
    chatKey.current += 1;
    const key = chatKey.current;
    setChat((list) => (line.id && list.some((l) => l.id === line.id) ? list : [...list.slice(-(CHAT_MAX - 1)), { ...line, key }]));
  }, []);

  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat]);

  // ── 실시간 채널: 관전 · 채팅 · 입력 중인 글자 ──
  const gameId = game?.id ?? "";
  const playerId = game?.member_id ?? "";
  const refetch = useCallback(async (id: string) => {
    const { data } = await supabase.from("word_games").select(WORD_GAME_COLUMNS).eq("id", id).maybeSingle();
    if (data) setGame(data as unknown as WordGameRow);
  }, []);
  useEffect(() => {
    if (!gameId) return;
    setChat([]);
    const watching = playerId !== currentMemberId;
    // 지난 채팅 (자리를 비운 사이 남긴 힌트도 보이게)
    void supabase
      .from("word_chat")
      .select("id,member_id,name,text,created_at")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(CHAT_MAX)
      .then(({ data }) => {
        for (const row of ((data ?? []) as ChatRow[]).reverse()) {
          addChat({ id: row.id, at: row.created_at, name: row.name, text: row.text, kind: row.member_id === currentMemberId ? "me" : undefined });
        }
      });
    const channel = supabase
      .channel(`word-${gameId}`, { config: { broadcast: { self: false }, presence: { key: currentMemberId } } })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Array<{ name?: string }>>;
        setViewers(Object.entries(state).filter(([id]) => id !== playerId).map(([, metas]) => metas[0]?.name ?? "?"));
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        const name = (newPresences[0] as { name?: string } | undefined)?.name;
        if (key !== currentMemberId && key !== playerId && name) addChat({ name: "", text: `👀 ${name}님이 관전을 시작했어요`, kind: "sys" });
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const data = payload as { id?: string; at?: string; name?: string; text?: string };
        if (data.text) addChat({ id: data.id, at: data.at, name: String(data.name ?? "").slice(0, 10), text: String(data.text).slice(0, 80) });
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const jamo = (payload as { jamo?: unknown }).jamo;
        if (watching && Array.isArray(jamo)) setTyped(jamo.slice(0, WORD_LEN).map(String));
      })
      .on("broadcast", { event: "game" }, () => {
        if (watching) {
          setTyped([]);
          void refetch(gameId);
        }
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") void channel.track({ name: myName });
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [gameId, playerId, currentMemberId, myName, addChat, refetch]);

  // 자동 구매 안내는 판이 시작될 때 5초만 보여 준다
  const autoKey = game && game.status === "playing" && game.auto_bought && game.tries === 0 && game.member_id === currentMemberId ? game.id : "";
  useEffect(() => {
    if (!autoKey) return setAutoNote(false);
    setAutoNote(true);
    const timer = window.setTimeout(() => setAutoNote(false), 5000);
    return () => window.clearTimeout(timer);
  }, [autoKey]);

  // 관전: 실시간이 끊겨도 따라가게 가끔 다시 읽고, 끝나면 그 사람의 다음 판으로 넘어간다
  useEffect(() => {
    if (!spectating || !game) return;
    const timer = setInterval(async () => {
      if (game.status === "escrow" || game.status === "playing") return void refetch(game.id);
      const { data } = await supabase
        .from("word_games")
        .select(WORD_GAME_COLUMNS)
        .eq("member_id", game.member_id)
        .in("status", ["escrow", "playing"])
        .gt("created_at", game.created_at)
        .limit(1);
      const next = (data ?? [])[0] as unknown as WordGameRow | undefined;
      if (next) {
        setShowResult(false);
        setTyped([]);
        setGame(next);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [spectating, game, refetch]);

  // 내가 치는 글자를 관전자에게
  useEffect(() => {
    if (spectating || !game || game.status !== "playing") return;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { jamo: typed } });
  }, [typed, spectating, game]);

  async function askHelp() {
    if (!game) return;
    if (!window.confirm("카톡방에 도움 요청을 보낼까요?\n지금까지 입력한 칸과 관전 링크가 함께 올라가요.")) return;
    const id = game.id;
    const result = await callWord({ action: "help", gameId: id });
    if (!result.ok) return setMessage(result.error ?? "요청하지 못했습니다.");
    setMessage("📣 도움 요청 중… (카톡 봇이 올려요)");
    // 봇이 실제로 올렸는지 확인한다
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = (await callWord({ action: "helpStatus", gameId: id })) as CallResult & { sent?: boolean };
      if (status.sent) return setMessage("✅ 카톡방에 도움을 요청했어요. 링크로 들어와 같이 볼 수 있어요.");
    }
    setMessage("⚠️ 카톡 봇이 아직 알림을 올리지 않았어요. 봇이 켜져 있는지 확인해 주세요. (word_bridge.py)");
  }

  async function sendChat() {
    const text = chatText.trim().slice(0, 80);
    if (!text || !game) return;
    setChatText("");
    const at = new Date().toISOString();
    addChat({ name: myName, text, kind: "me", at });
    // 저장해 두고(나중에 와도 보이게) 지금 보는 사람들에게는 바로 보낸다
    const result = (await callWord({ action: "chat", gameId: game.id, text })) as CallResult & { chatId?: string };
    if (!result.ok) setMessage(result.error ?? "채팅을 저장하지 못했어요.");
    void channelRef.current?.send({ type: "broadcast", event: "chat", payload: { id: result.chatId, at, name: myName, text } });
  }

  // 봇이 티켓을 확인하는 동안 · 끝난 판 보상 지급을 기다리는 동안
  const waiting = game && (game.status === "escrow" || ((game.status === "won" || game.status === "lost") && game.settle_state !== "done"));
  useEffect(() => {
    if (!game || !waiting || game.member_id !== currentMemberId) return;
    const timer = setInterval(async () => {
      const { data } = await supabase.from("word_games").select(WORD_GAME_COLUMNS).eq("id", game.id).maybeSingle();
      if (!data) return;
      const row = data as unknown as WordGameRow;
      if (row.status === "escrow") {
        const waited = Date.now() - new Date(row.created_at).getTime();
        if (waited > 20000) {
          setMessage(
            waited > 60000
              ? "⚠️ 카톡 봇이 응답하지 않아요. 봇에 word_bridge.py 가 없거나 재시작 전일 수 있어요. ⋯ 메뉴에서 '시작 취소'를 할 수 있어요. (티켓은 차감되지 않았어요)"
              : "⏳ 카톡 봇이 아직 응답하지 않아요. 조금만 기다려 주세요…",
          );
        }
      }
      if (row.status === "rejected") {
        setMessage(`🚫 시작하지 못했어요. ${row.reject_reason ?? ""}`);
        setGame(null);
        void load();
        return;
      }
      if (row.status !== game.status || row.settle_state !== game.settle_state) {
        if (game.status === "escrow") setMessage("");
        setGame(row);
        void load();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [game, waiting, load, currentMemberId]);

  useEffect(() => () => {
    if (retry.current.timer) clearTimeout(retry.current.timer);
  }, []);

  async function start() {
    setBusy(true);
    setMessage("");
    setShowResult(false);
    setTyped([]);
    const result = await callWord({ action: "start" });
    setBusy(false);
    if (!result.ok || !result.id) {
      setMessage(result.error ?? "시작하지 못했습니다.");
      return;
    }
    const rows = await load();
    setGame(rows.find((r) => r.id === result.id) ?? null);
  }

  async function quit() {
    setMenu(false);
    if (!game) return;
    if (game.status === "playing" && !window.confirm("포기할까요? 티켓은 돌려받지 못하고, 정답을 알려드려요.")) return;
    const result = await callWord({ action: "quit", gameId: game.id });
    if (!result.ok) {
      setMessage(result.error ?? "포기하지 못했습니다.");
      return;
    }
    const rows = await load();
    const row = rows.find((r) => r.id === game.id) ?? null;
    setGame(row && row.status !== "rejected" ? row : null);
    if (row?.status === "lost") setShowResult(true);
  }

  const submit = useCallback(async (jamo: string[], again = false) => {
    if (!game || game.status !== "playing") return;
    if (jamo.length !== WORD_LEN) {
      setMessage(`자모 ${WORD_LEN}개를 모두 입력해 주세요.`);
      setShake(true);
      return;
    }
    const key = jamo.join("");
    if (!again) {
      if (retry.current.timer) clearTimeout(retry.current.timer);
      retry.current = { key, count: 0, timer: null };
    }
    setBusy(true);
    const result = await callWord({ action: "guess", gameId: game.id, jamo });
    setBusy(false);
    if (result.ok && result.game) {
      retry.current.key = "";
      setMessage("");
      setGame(result.game);
      setTyped([]);
      void channelRef.current?.send({ type: "broadcast", event: "game", payload: {} });
      if (result.game.status !== "playing") {
        void load();
        setTimeout(() => setShowResult(true), 1700);
      }
      return;
    }
    if (result.pending && retry.current.key === key && retry.current.count < PENDING_MAX_RETRY) {
      setMessage(`⏳ ${result.error ?? "AI 검증 중…"} (기회 차감 없음)`);
      retry.current.count += 1;
      retry.current.timer = setTimeout(() => {
        if (retry.current.key === key) void submit(jamo, true);
      }, PENDING_RETRY_MS);
      return;
    }
    retry.current.key = "";
    setMessage(result.pending ? "AI 검증이 늦어지고 있어요. 잠시 뒤 다시 입력해 주세요." : result.error ?? "입력하지 못했습니다.");
    setShake(true);
  }, [game, load]);

  const press = useCallback((key: string) => {
    if (!game || game.status !== "playing" || busy || game.member_id !== currentMemberId) return;
    if (key === "back") {
      retry.current.key = "";
      setTyped((t) => t.slice(0, -1));
      return;
    }
    setTyped((t) => (t.length < WORD_LEN ? [...t, key] : t));
  }, [game, busy, currentMemberId]);

  // 컴퓨터 자판: 한/영 상관없이 자판 위치(code)로 읽는다
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingField(event.target)) return;
      if (event.key === "Backspace") {
        event.preventDefault(); // 웨일 등 일부 브라우저: 백스페이스 = 뒤로 가기
        return press("back");
      }
      if (event.key === "Enter") {
        event.preventDefault();
        return void submit(typed);
      }
      const letter = event.code.startsWith("Key") ? QWERTY[event.code.slice(3).toLowerCase()] : undefined;
      if (letter) {
        event.preventDefault();
        press(letter);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, submit, typed]);

  useEffect(() => {
    if (!shake) return;
    const timer = setTimeout(() => setShake(false), 450);
    return () => clearTimeout(timer);
  }, [shake]);

  // 자판 색: 가장 좋은 결과로
  const keyMarks: Record<string, Mark> = {};
  for (const row of game?.history ?? []) {
    row.jamo.forEach((j, i) => {
      const mark = row.result[i];
      if (!keyMarks[j] || RANK[mark] > RANK[keyMarks[j]]) keyMarks[j] = mark;
    });
  }

  const finished = game && (game.status === "won" || game.status === "lost");
  const history = game?.history ?? [];
  const preview = typed.length === WORD_LEN ? composeWords(typed) : [];
  const record = games.filter((g) => g.status === "won" || g.status === "lost");
  const wins = record.filter((g) => g.status === "won").length;

  return (
    <div
      className="meetingModalBackdrop gameBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`meetingModal gameModal wdModal ${chatting && game ? "chatting" : ""}`} role="dialog" aria-modal="true">
        <header className="wdHeader">
          <button className="wdIcon" aria-label="뒤로" onClick={spectating ? onBack : game && !finished ? () => setMenu((m) => !m) : game ? () => setGame(null) : onBack}>
            ‹
          </button>
          <h2>단어게임</h2>
          <button className="wdIcon" aria-label="메뉴" onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="wdMenu" onClick={() => setMenu(false)}>
              {!spectating && game?.status === "playing" && <button onClick={() => void quit()}>🏳️ 포기하기</button>}
              {!spectating && game?.status === "escrow" && <button onClick={() => void quit()}>✖ 시작 취소</button>}
              {game && <button onClick={() => setGame(null)}>📋 내 기록</button>}
              <button onClick={onBack}>🎮 게임 목록</button>
              <button onClick={onClose}>✕ 닫기</button>
            </div>
          )}
        </header>

        {!game ? (
          <div className="wdLobby">
            <div className="wdIntro">
              <strong>📝 단어를 자모로 풀어서 5칸 안에 맞혀요</strong>
              <p>
                예) 학교 → ㅎ ㅏ ㄱ ㄱ ㅛ · 과자 → ㄱ ㅗ ㅏ ㅈ ㅏ
                <br />
                <span className="wdChip g">ㅇ</span> 자리까지 맞음 <span className="wdChip y">ㅇ</span> 들어 있지만 자리가 다름{" "}
                <span className="wdChip x">ㅇ</span> 없음
              </p>
              <ul>
                <li>🎫 티켓 1장 (없으면 {TICKET_PRICE}점으로 자동 구매) · 기회 {MAX_TRIES}번</li>
                <li>
                  💎 정답 보상:{" "}
                  {Object.entries(REWARDS)
                    .map(([n, p]) => `${n}번 ${p}`)
                    .join(" · ")}
                  점
                </li>
                <li>🤖 단어장에 없는 단어는 AI가 확인해요 (기회 차감 없음) · 카톡 !단어 전적에 합산</li>
              </ul>
              <span className="wdMine">
                내 점수 💎 {myPoints !== null ? fmt(myPoints) : "-"} · 티켓 🎫 {myTickets ?? "-"}
              </span>
            </div>
            {message && <div className="omokMessage">{message}</div>}
            <div className="wdRecord">
              <b>📋 내 기록</b>
              <span>
                {record.length}판 · 정답 {wins}번{record.length ? ` (${Math.round((wins / record.length) * 100)}%)` : ""}
              </span>
            </div>
            <div className="wdRecent">
              {loaded && record.length === 0 && <span className="muted">아직 기록이 없어요.</span>}
              {record.slice(0, 15).map((g) => (
                <button key={g.id} className="wdRecentRow" onClick={() => { setGame(g); setShowResult(false); }}>
                  <span>{shortDate(g.created_at)}</span>
                  <b>{g.answer ?? "-"}</b>
                  <em className={g.status}>{g.status === "won" ? `🎉 ${g.tries}번 만에 +${g.reward}점` : "💀 실패"}</em>
                </button>
              ))}
            </div>
            <div className="wdBottom">
              <button className="wdBig" disabled={busy} onClick={() => void start()}>
                {busy ? "시작하는 중…" : "시작하기"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="wdPlay">
              {!spectating && game.status === "playing" && (
                <button className="wdHelp" onClick={() => void askHelp()}>🆘 도움!</button>
              )}
              {(spectating || viewers.length > 0) && (
                <div className="wdWatch">
                  {spectating ? `👀 ${game.name}님의 도전을 관전 중` : `👀 ${viewers.length}명 관전 중`}
                  {viewers.length > 0 && <span>{viewers.slice(0, 6).join(" · ")}</span>}
                </div>
              )}
              <div className="wdHint">
                {game.status === "escrow"
                  ? "🎫 티켓 확인 중… (카톡 봇이 처리해요)"
                  : finished
                    ? game.status === "won"
                      ? `🎉 ${game.tries}번 만에 정답!`
                      : `💀 정답은 [${game.answer ?? "?"}]`
                    : `힌트: ${game.hint_len ?? "?"}글자 단어 · 남은 기회 ${game.max_tries - game.tries}번`}
              </div>
              <div className="wdBoard">
                {Array.from({ length: MAX_TRIES }, (_, r) => {
                  const done = history[r];
                  const current = !done && r === history.length && game.status === "playing";
                  return (
                    <div key={r} className={`wdRow ${current && shake ? "shake" : ""}`}>
                      {Array.from({ length: WORD_LEN }, (_, c) => {
                        const letter = done ? done.jamo[c] : current ? typed[c] : "";
                        const mark = done ? done.result[c] : "";
                        return (
                          <div
                            key={c}
                            className={`wdTile ${mark} ${done ? "flip" : ""} ${letter && !done ? "typed" : ""}`}
                            style={done ? { animationDelay: `${c * 0.12}s` } : undefined}
                          >
                            {letter}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div className="wdNote">
                {message || (preview.length ? `👉 ${preview.join(" · ")}` : autoNote ? `🎫 티켓 자동 구매 (-${TICKET_PRICE}점)` : "")}
              </div>
            </div>
            <div className={`wdChat ${spectating ? "big" : ""}`}>
              <div className="wdChatLog" ref={chatLogRef}>
                {chat.length === 0 && (
                  <span className="muted">{spectating ? "같이 보면서 힌트를 나눠 보세요 💬" : "관전하는 사람들과 채팅할 수 있어요 💬"}</span>
                )}
                {chat.map((line) => (
                  <div key={line.key} className={`wdChatLine ${line.kind ?? ""}`}>
                    {line.at && <time>{chatTime(line.at)}</time>}
                    {line.name && <b>{line.name}</b>} {line.text}
                  </div>
                ))}
              </div>
              <form
                className="wdChatInput"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat();
                }}
              >
                <input
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                  onFocus={() => {
                    window.clearTimeout(blurTimer.current);
                    setChatting(true);
                  }}
                  onBlur={() => {
                    // 보내기를 누를 때 잠깐 포커스가 빠져도 화면이 출렁이지 않게 조금 늦게 푼다
                    window.clearTimeout(blurTimer.current);
                    blurTimer.current = window.setTimeout(() => setChatting(false), 200);
                  }}
                  placeholder="채팅"
                  maxLength={80}
                  enterKeyHint="send"
                  autoComplete="off"
                  aria-label="채팅 입력"
                />
                <button type="submit" aria-label="보내기" onPointerDown={(event) => event.preventDefault()}>↑</button>
              </form>
            </div>
            {!spectating && (
            <div className="wdKeys">
              {KEY_ROWS.map((row, i) => (
                <div className="wdKeyRow" key={i}>
                  {row.map((k) => (
                    <button key={k} className={`wdKey ${keyMarks[k] ?? ""}`} onClick={() => press(k)} disabled={game.status !== "playing"}>
                      {k}
                    </button>
                  ))}
                  {i === 0 && (
                    <button className="wdKey back" aria-label="지우기" onClick={() => press("back")} disabled={game.status !== "playing"}>
                      ←
                    </button>
                  )}
                </div>
              ))}
              {finished ? (
                <button className="wdBig" onClick={() => setShowResult(true)}>결과보기</button>
              ) : (
                <button
                  className="wdBig"
                  disabled={busy || game.status !== "playing" || typed.length !== WORD_LEN}
                  onClick={() => void submit(typed)}
                >
                  {game.status === "escrow" ? "티켓 확인 중…" : busy ? "확인 중…" : "입력"}
                </button>
              )}
            </div>
            )}
            {spectating && finished && (
              <div className="wdKeys">
                <button className="wdBig" onClick={() => setShowResult(true)}>결과보기</button>
              </div>
            )}
          </>
        )}

        {showResult && game && finished && (
          <div className="wdResultBack" onClick={() => setShowResult(false)}>
            <div className="wdResult" onClick={(e) => e.stopPropagation()}>
              <span className="wdResultIcon">{game.status === "won" ? "🎉" : "💀"}</span>
              <strong>{spectating ? `${game.name}님 · ` : ""}{game.status === "won" ? `${game.tries}번 만에 정답!` : "아쉬워요"}</strong>
              <div className="wdAnswer">{game.answer ?? "?"}</div>
              <div className="wdMini">
                {game.history.map((row, i) => (
                  <div key={i}>
                    {row.result.map((m, j) => (
                      <i key={j} className={m} />
                    ))}
                  </div>
                ))}
              </div>
              {game.status === "won" && (
                <p>
                  💎 +{game.reward}점 {game.settle_state === "done" ? "지급 완료" : "· 카톡 봇이 지급 중…"}
                </p>
              )}
              <div className="wdResultButtons">
                <button className="wdBig" disabled={busy} onClick={() => void start()}>{spectating ? "나도 도전" : "한 판 더"}</button>
                <button className="smallButton ghost" onClick={() => { setShowResult(false); setGame(null); }}>내 기록</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
