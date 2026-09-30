"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { BOARD_SIZE, TURN_SECONDS, boardFromMoves, forbiddenPoints, type Move } from "../lib/omok";

type OmokRow = {
  id: string;
  status: "open" | "challenge" | "escrow" | "playing" | "finished" | "cancelled";
  stake: number;
  host_member: string;
  host_name: string;
  guest_member: string | null;
  guest_name: string | null;
  target_member: string | null;
  black: "host" | "guest" | null;
  moves: Move[];
  turn_deadline: string | null;
  winner: "host" | "guest" | "draw" | null;
  end_reason: string | null;
  escrow_state: string;
  escrow_note: string | null;
  settle_state: string;
  created_at: string;
  finished_at: string | null;
};

type Opponent = { id: string; name: string };

type Props = {
  onClose: () => void;
  currentMemberId: string | null;
  myPoints: number | null;
  myTickets: number | null;
  opponents: Opponent[];
};

const COLUMNS =
  "id,status,stake,host_member,host_name,guest_member,guest_name,target_member,black,moves,turn_deadline,winner,end_reason,escrow_state,escrow_note,settle_state,created_at,finished_at";
const STAKE_PRESETS = [100, 300, 500, 1000];
const CELL = 30;
const PAD = 20;
const VIEW = PAD * 2 + CELL * (BOARD_SIZE - 1);
const STARS: Move[] = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];
const END_TEXT: Record<string, string> = {
  five: "오목 완성",
  timeout: "시간 초과",
  resign: "기권",
  draw: "무승부 (판이 가득 참)",
};

async function callOmok(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/omok", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as {
    ok: boolean;
    error?: string;
    id?: string;
  };
}

function nameOf(game: OmokRow, side: "host" | "guest" | null) {
  if (side === "host") return game.host_name;
  if (side === "guest") return game.guest_name ?? "?";
  return "?";
}

export default function OmokGame({ onClose, currentMemberId, myPoints, myTickets, opponents }: Props) {
  const [games, setGames] = useState<OmokRow[]>([]);
  const [viewId, setViewId] = useState<string>("");
  const [stake, setStake] = useState("100");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Move | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastTick = useRef(0);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("omok_games")
      .select(COLUMNS)
      .or(`status.in.(open,challenge,escrow,playing),finished_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(40);
    if (!error) setGames((data ?? []) as OmokRow[]);
  }, []);

  const myActive = useMemo(
    () =>
      games.find(
        (game) =>
          ["open", "challenge", "escrow", "playing"].includes(game.status) &&
          (game.host_member === currentMemberId || game.guest_member === currentMemberId),
      ) ?? null,
    [games, currentMemberId],
  );

  // 내 대국이 시작되면 자동으로 판을 연다
  useEffect(() => {
    if (myActive && (myActive.status === "escrow" || myActive.status === "playing")) {
      setViewId((current) => current || myActive.id);
    }
  }, [myActive]);

  const viewing = games.find((game) => game.id === viewId) ?? null;
  const live = viewing && (viewing.status === "playing" || viewing.status === "escrow");

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), live ? 1200 : 3000);
    return () => window.clearInterval(timer);
  }, [load, live]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  // 시간이 다 되면 서버에 확인을 요청한다 (상대가 창을 닫아도 끝나도록)
  useEffect(() => {
    if (!viewing || viewing.status !== "playing" || !viewing.turn_deadline) return;
    const over = now - new Date(viewing.turn_deadline).getTime();
    if (over > 2500 && now - lastTick.current > 3000) {
      lastTick.current = now;
      void callOmok({ action: "tick", gameId: viewing.id }).then(() => load());
    }
  }, [now, viewing, load]);

  async function run(payload: Record<string, unknown>, after?: (id?: string) => void) {
    setBusy(true);
    setMessage("");
    const result = await callOmok(payload);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "실패했습니다.");
    } else {
      after?.(result.id);
    }
    await load();
  }

  const openRooms = games.filter((game) => game.status === "open" && game.host_member !== currentMemberId);
  const challengesToMe = games.filter(
    (game) => game.status === "challenge" && game.target_member === currentMemberId,
  );
  const liveGames = games.filter((game) => game.status === "playing" && game.id !== myActive?.id);
  const recent = games.filter((game) => game.status === "finished").slice(0, 8);

  return (
    <div
      className="meetingModalBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal omokModal" role="dialog" aria-modal="true">
        <div className="meetingModalHeader">
          <div>
            <span>렌주룰 · 한 수 {TURN_SECONDS}초 · 티켓 1장씩</span>
            <h2>⚫ 오목 대결</h2>
          </div>
          <button className="modalCloseButton" onClick={onClose}>×</button>
        </div>

        {message && <div className="omokMessage">{message}</div>}

        {viewing ? (
          <OmokBoardView
            game={viewing}
            me={currentMemberId}
            now={now}
            busy={busy}
            pending={pending}
            setPending={setPending}
            onBack={() => {
              setViewId("");
              setPending(null);
            }}
            onMove={(x, y) => run({ action: "move", gameId: viewing.id, x, y }, () => setPending(null))}
            onResign={() => {
              if (window.confirm("기권하면 판돈을 잃습니다. 기권할까요?")) {
                void run({ action: "resign", gameId: viewing.id });
              }
            }}
            onCancel={() => run({ action: "cancel", gameId: viewing.id }, () => setViewId(""))}
          />
        ) : (
          <div className="omokLobby">
            <div className="omokMine">
              <span>내 점수 <strong>💎 {myPoints !== null ? myPoints.toLocaleString("ko-KR") : "-"}</strong></span>
              <span>티켓 <strong>🎫 {myTickets ?? "-"}</strong></span>
            </div>

            {myActive && (
              <div className="omokCard highlight">
                <div>
                  <strong>
                    {myActive.status === "open"
                      ? "상대를 기다리는 중…"
                      : myActive.status === "challenge"
                        ? "도전장 응답 대기 중…"
                        : myActive.status === "escrow"
                          ? "봇이 점수·티켓 확인 중…"
                          : "대국 진행 중"}
                  </strong>
                  <span>판돈 {myActive.stake.toLocaleString("ko-KR")}점</span>
                </div>
                <div className="omokCardActions">
                  {(myActive.status === "escrow" || myActive.status === "playing") && (
                    <button className="smallButton" onClick={() => setViewId(myActive.id)}>판 보기</button>
                  )}
                  {(myActive.status === "open" || myActive.status === "challenge") && (
                    <button className="smallButton ghost" disabled={busy} onClick={() => run({ action: "cancel", gameId: myActive.id })}>
                      취소
                    </button>
                  )}
                </div>
              </div>
            )}

            {challengesToMe.map((game) => (
              <div className="omokCard challenge" key={game.id}>
                <div>
                  <strong>⚔️ {game.host_name}님의 도전장</strong>
                  <span>판돈 {game.stake.toLocaleString("ko-KR")}점</span>
                </div>
                <div className="omokCardActions">
                  <button className="smallButton" disabled={busy || !!myActive} onClick={() => run({ action: "join", gameId: game.id }, () => setViewId(game.id))}>
                    수락
                  </button>
                  <button className="smallButton ghost" disabled={busy} onClick={() => run({ action: "decline", gameId: game.id })}>
                    거절
                  </button>
                </div>
              </div>
            ))}

            {!myActive && (
              <div className="omokCreate">
                <strong>새 대국</strong>
                <div className="omokStakeRow">
                  {STAKE_PRESETS.map((value) => (
                    <button
                      key={value}
                      className={`omokChip ${stake === String(value) ? "active" : ""}`}
                      onClick={() => setStake(String(value))}
                    >
                      {value.toLocaleString("ko-KR")}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={10}
                    value={stake}
                    onChange={(event) => setStake(event.target.value)}
                    aria-label="판돈"
                  />
                  <span>점</span>
                </div>
                <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="상대">
                  <option value="">누구나 (대기실에 방 열기)</option>
                  {opponents.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}에게 도전장
                    </option>
                  ))}
                </select>
                <button
                  className="primaryButton"
                  disabled={busy}
                  onClick={() => run({ action: "create", stake: Number(stake), targetMemberId: target || null })}
                >
                  {target ? "도전장 보내기" : "방 만들기"}
                </button>
                <small>이기면 상대 판돈을 가져가고, 비기면 돌려받습니다. 티켓은 돌려받지 않습니다.</small>
              </div>
            )}

            <div className="omokSection">
              <strong>대기 중인 방</strong>
              {openRooms.length === 0 && <span className="muted">열린 방이 없습니다.</span>}
              {openRooms.map((game) => (
                <div className="omokCard" key={game.id}>
                  <div>
                    <strong>{game.host_name}</strong>
                    <span>판돈 {game.stake.toLocaleString("ko-KR")}점</span>
                  </div>
                  <button className="smallButton" disabled={busy || !!myActive} onClick={() => run({ action: "join", gameId: game.id }, () => setViewId(game.id))}>
                    도전
                  </button>
                </div>
              ))}
            </div>

            {liveGames.length > 0 && (
              <div className="omokSection">
                <strong>진행 중 (관전)</strong>
                {liveGames.map((game) => (
                  <div className="omokCard" key={game.id}>
                    <div>
                      <strong>{game.host_name} vs {game.guest_name}</strong>
                      <span>판돈 {game.stake.toLocaleString("ko-KR")}점 · {game.moves.length}수</span>
                    </div>
                    <button className="smallButton ghost" onClick={() => setViewId(game.id)}>관전</button>
                  </div>
                ))}
              </div>
            )}

            {recent.length > 0 && (
              <div className="omokSection">
                <strong>최근 결과</strong>
                {recent.map((game) => (
                  <button className="omokResultRow" key={game.id} onClick={() => setViewId(game.id)}>
                    <span>
                      {game.winner === "draw"
                        ? `${game.host_name} = ${game.guest_name}`
                        : `🏆 ${nameOf(game, game.winner)} ▸ ${nameOf(game, game.winner === "host" ? "guest" : "host")}`}
                    </span>
                    <em>{game.stake.toLocaleString("ko-KR")}점 · {END_TEXT[game.end_reason ?? ""] ?? ""}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function OmokBoardView({
  game,
  me,
  now,
  busy,
  pending,
  setPending,
  onBack,
  onMove,
  onResign,
  onCancel,
}: {
  game: OmokRow;
  me: string | null;
  now: number;
  busy: boolean;
  pending: Move | null;
  setPending: (move: Move | null) => void;
  onBack: () => void;
  onMove: (x: number, y: number) => void;
  onResign: () => void;
  onCancel: () => void;
}) {
  const board = useMemo(() => boardFromMoves(game.moves), [game.moves]);
  const mySide = game.host_member === me ? "host" : game.guest_member === me ? "guest" : null;
  const blackSide = game.black;
  const whiteSide = blackSide === "host" ? "guest" : blackSide === "guest" ? "host" : null;
  const blackTurn = game.moves.length % 2 === 0;
  const turnSide = blackTurn ? blackSide : whiteSide;
  const myTurn = game.status === "playing" && mySide !== null && mySide === turnSide;
  const iAmBlack = mySide !== null && mySide === blackSide;

  const forbidden = useMemo(
    () => (myTurn && iAmBlack ? forbiddenPoints(boardFromMoves(game.moves)) : []),
    [myTurn, iAmBlack, game.moves],
  );
  const forbiddenSet = useMemo(() => new Set(forbidden.map(([x, y]) => `${x},${y}`)), [forbidden]);

  const remaining = game.turn_deadline
    ? Math.max(0, Math.ceil((new Date(game.turn_deadline).getTime() - now) / 1000))
    : TURN_SECONDS;
  const last = game.moves[game.moves.length - 1];

  function handleClick(x: number, y: number) {
    if (!myTurn || busy || board[y][x] !== 0 || forbiddenSet.has(`${x},${y}`)) return;
    if (pending && pending[0] === x && pending[1] === y) {
      onMove(x, y);
    } else {
      setPending([x, y]);
    }
  }

  let status = "";
  if (game.status === "escrow") {
    status = "🤖 봇이 점수·티켓을 확인하고 있습니다… (보통 10초 이내)";
  } else if (game.status === "playing") {
    status = myTurn ? `내 차례 · ${remaining}초` : `${nameOf(game, turnSide)}님 차례 · ${remaining}초`;
  } else if (game.status === "finished") {
    const settle = game.settle_state === "done" ? "카톡 점수에 반영 완료" : "봇이 곧 카톡 점수에 반영합니다";
    if (game.winner === "draw") status = `🤝 무승부 · 판돈 반환 · ${settle}`;
    else {
      const winnerName = nameOf(game, game.winner);
      const mine = mySide ? (game.winner === mySide ? "🎉 승리! " : "😢 패배 · ") : "";
      status = `${mine}🏆 ${winnerName} 승 (${END_TEXT[game.end_reason ?? ""] ?? ""}) · ${settle}`;
    }
  } else if (game.status === "cancelled") {
    status = game.escrow_note ? `취소됨 · ${game.escrow_note}` : "취소된 대국입니다.";
  }

  return (
    <div className="omokGame">
      <div className="omokPlayers">
        <div className={`omokPlayer ${game.status === "playing" && blackTurn ? "turn" : ""}`}>
          <i className="omokStoneIcon black" />
          <strong>{nameOf(game, blackSide)}</strong>
          {mySide === blackSide && <em>나</em>}
        </div>
        <span className="omokStake">💎 {game.stake.toLocaleString("ko-KR")}</span>
        <div className={`omokPlayer ${game.status === "playing" && !blackTurn ? "turn" : ""}`}>
          <i className="omokStoneIcon white" />
          <strong>{nameOf(game, whiteSide)}</strong>
          {mySide === whiteSide && <em>나</em>}
        </div>
      </div>

      {game.status === "playing" && (
        <div className="omokTimer">
          <div
            className={remaining <= 10 ? "urgent" : ""}
            style={{ width: `${(remaining / TURN_SECONDS) * 100}%` }}
          />
        </div>
      )}

      <p className={`omokStatus ${myTurn ? "mine" : ""}`}>{status}</p>

      <svg className="omokBoard" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="오목판">
        <rect x="0" y="0" width={VIEW} height={VIEW} rx="10" className="omokBoardBg" />
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <g key={i} className="omokLine">
            <line x1={PAD} y1={PAD + i * CELL} x2={PAD + (BOARD_SIZE - 1) * CELL} y2={PAD + i * CELL} />
            <line x1={PAD + i * CELL} y1={PAD} x2={PAD + i * CELL} y2={PAD + (BOARD_SIZE - 1) * CELL} />
          </g>
        ))}
        {STARS.map(([x, y]) => (
          <circle key={`s${x},${y}`} cx={PAD + x * CELL} cy={PAD + y * CELL} r="3" className="omokStar" />
        ))}
        {forbidden.map(([x, y]) => (
          <text key={`f${x},${y}`} x={PAD + x * CELL} y={PAD + y * CELL + 5} className="omokForbidden" textAnchor="middle">
            ×
          </text>
        ))}
        {game.moves.map(([x, y], index) => (
          <circle
            key={`m${index}`}
            cx={PAD + x * CELL}
            cy={PAD + y * CELL}
            r="13"
            className={index % 2 === 0 ? "omokStone black" : "omokStone white"}
          />
        ))}
        {last && <circle cx={PAD + last[0] * CELL} cy={PAD + last[1] * CELL} r="4" className="omokLast" />}
        {pending && (
          <circle
            cx={PAD + pending[0] * CELL}
            cy={PAD + pending[1] * CELL}
            r="13"
            className={`omokStone ghost ${blackTurn ? "black" : "white"}`}
          />
        )}
        {myTurn &&
          Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
            const x = index % BOARD_SIZE;
            const y = Math.floor(index / BOARD_SIZE);
            if (board[y][x] !== 0) return null;
            return (
              <rect
                key={`h${index}`}
                x={PAD + x * CELL - CELL / 2}
                y={PAD + y * CELL - CELL / 2}
                width={CELL}
                height={CELL}
                className="omokHit"
                onClick={() => handleClick(x, y)}
              />
            );
          })}
      </svg>

      <div className="omokControls">
        <button className="smallButton ghost" onClick={onBack}>← 대기실</button>
        {myTurn && pending && (
          <button className="primaryButton" disabled={busy} onClick={() => onMove(pending[0], pending[1])}>
            여기에 두기
          </button>
        )}
        {game.status === "playing" && mySide && (
          <button className="smallButton ghost danger" disabled={busy} onClick={onResign}>기권</button>
        )}
        {game.status === "escrow" && mySide && game.escrow_state === "requested" && (
          <button className="smallButton ghost" disabled={busy} onClick={onCancel}>취소</button>
        )}
      </div>
      {myTurn && <small className="muted omokHint">칸을 누르면 미리보기, 한 번 더 누르면 착수됩니다.{iAmBlack ? " × 는 흑 금수 자리입니다." : ""}</small>}
    </div>
  );
}
