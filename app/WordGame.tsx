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
  myPoints: number | null;
  myTickets: number | null;
};

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

function shortDate(value: string) {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function WordGame({ onClose, onBack, currentMemberId, myPoints, myTickets }: Props) {
  const [games, setGames] = useState<WordGameRow[]>([]);
  const [game, setGame] = useState<WordGameRow | null>(null);
  const [typed, setTyped] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [menu, setMenu] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const retry = useRef<{ key: string; count: number; timer: ReturnType<typeof setTimeout> | null }>({ key: "", count: 0, timer: null });

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

  // 처음: 진행 중인 판이 있으면 이어서
  useEffect(() => {
    void load().then((rows) => {
      const live = rows.find((r) => r.status === "escrow" || r.status === "playing");
      if (live) setGame(live);
    });
  }, [load]);

  // 봇이 티켓을 확인하는 동안 · 끝난 판 보상 지급을 기다리는 동안
  const waiting = game && (game.status === "escrow" || ((game.status === "won" || game.status === "lost") && game.settle_state !== "done"));
  useEffect(() => {
    if (!game || !waiting) return;
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
  }, [game, waiting, load]);

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
    if (!game || game.status !== "playing" || busy) return;
    if (key === "back") {
      retry.current.key = "";
      setTyped((t) => t.slice(0, -1));
      return;
    }
    setTyped((t) => (t.length < WORD_LEN ? [...t, key] : t));
  }, [game, busy]);

  // 컴퓨터 자판: 한/영 상관없이 자판 위치(code)로 읽는다
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") return press("back");
      if (event.key === "Enter") return void submit(typed);
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
      <section className="meetingModal gameModal wdModal" role="dialog" aria-modal="true">
        <header className="wdHeader">
          <button className="wdIcon" aria-label="뒤로" onClick={game && !finished ? () => setMenu((m) => !m) : game ? () => setGame(null) : onBack}>
            ‹
          </button>
          <h2>오늘의 단어</h2>
          <button className="wdIcon" aria-label="메뉴" onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="wdMenu" onClick={() => setMenu(false)}>
              {game?.status === "playing" && <button onClick={() => void quit()}>🏳️ 포기하기</button>}
              {game?.status === "escrow" && <button onClick={() => void quit()}>✖ 시작 취소</button>}
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
                {message || (preview.length ? `👉 ${preview.join(" · ")}` : game.auto_bought ? `🎫 티켓 자동 구매 (-${TICKET_PRICE}점)` : "")}
              </div>
            </div>
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
          </>
        )}

        {showResult && game && finished && (
          <div className="wdResultBack" onClick={() => setShowResult(false)}>
            <div className="wdResult" onClick={(e) => e.stopPropagation()}>
              <span className="wdResultIcon">{game.status === "won" ? "🎉" : "💀"}</span>
              <strong>{game.status === "won" ? `${game.tries}번 만에 정답!` : "아쉬워요"}</strong>
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
                <button className="wdBig" disabled={busy} onClick={() => void start()}>한 판 더</button>
                <button className="smallButton ghost" onClick={() => { setShowResult(false); setGame(null); }}>내 기록</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
