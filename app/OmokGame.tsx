"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { BOARD_SIZE, TURN_SECONDS, boardFromMoves, forbiddenPoints, type Board, type Move } from "../lib/omok";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  EMOTES,
  EMOTE_COOLDOWN_MS,
  EMOTE_SHOW_MS,
  EMOTE_SPOTS,
  EmoteIcon,
  isEmoteKind,
  pickEmoteSpot,
  spotStyle,
  type EmoteKind,
} from "./OmokEmotes";
import { GameResultPopup, RematchOfferPopup } from "./GameResult";

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
  is_test?: boolean;
  is_friendly?: boolean;
  undo?: { pending?: { by: "host" | "guest"; n: number } | null; used?: Partial<Record<"host" | "guest", number>> } | null;
  created_at: string;
  finished_at: string | null;
  started_at?: string | null;
};

export type Opponent = { id: string; name: string };

type ShownEmote = { kind: EmoteKind; spot: number; name: string; watcher: boolean; key: number };

type Props = {
  onClose: () => void;
  onBack?: () => void;
  initialGameId?: string;
  currentMemberId: string | null;
  myPoints: number | null;
  myTickets: number | null;
  myName: string;
  isAdmin?: boolean;
  opponents: Opponent[];
};

const COLUMNS =
  "id,status,stake,host_member,host_name,guest_member,guest_name,target_member,black,moves,turn_deadline,winner,end_reason,escrow_state,escrow_note,settle_state,is_test,is_friendly,undo,created_at,started_at,finished_at";
const STAKE_PRESETS = [100, 300, 500, 1000];
const MAX_UNDO = 3; // 한 사람당 한 판에 무르기 (서버와 같게)
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

// 한글 초성 검색: "ㅍ" → 푸들·퐁당, "ㅍㄷ" → 푸들, "푸ㄷ" → 푸들
const CHOSUNG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

function chosungOf(char: string) {
  const code = char.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return char;
  return CHOSUNG[Math.floor(code / 588)];
}

function matchesName(name: string, query: string) {
  const q = query.split(" ").join("").toLowerCase();
  if (!q) return true;
  const n = name.split(" ").join("").toLowerCase();
  for (let start = 0; start + q.length <= n.length; start += 1) {
    let ok = true;
    for (let i = 0; i < q.length && ok; i += 1) {
      const c = n[start + i];
      ok = CHOSUNG.includes(q[i]) ? chosungOf(c) === q[i] : c === q[i];
    }
    if (ok) return true;
  }
  return false;
}

export function OpponentPicker({
  opponents,
  value,
  onChange,
}: {
  opponents: Opponent[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = opponents.find((member) => member.id === value) ?? null;
  const matches = useMemo(
    () => opponents.filter((member) => matchesName(member.name, query)).slice(0, 8),
    [opponents, query],
  );

  if (selected) {
    return (
      <div className="omokPicked">
        <span>⚔️ <strong>{selected.name}</strong>님에게 대국신청</span>
        <button
          className="omokPickedClear"
          aria-label="상대 선택 취소"
          onClick={() => {
            onChange("");
            setQuery("");
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="omokPicker">
      <input
        type="search"
        value={query}
        placeholder="상대 닉네임 검색 (초성 가능) · 비우면 누구나"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches.length > 0 && query.trim()) {
            onChange(matches[0].id);
            setOpen(false);
          }
        }}
        aria-label="대국 상대 검색"
      />
      {open && query.trim() && (
        <ul className="omokPickerList">
          {matches.length === 0 && <li className="empty">일치하는 회원이 없습니다.</li>}
          {matches.map((member) => (
            <li key={member.id}>
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(member.id);
                  setOpen(false);
                }}
              >
                {member.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 판돈 표시 (친선전이면 점수 대신 '친선')
function stakeText(game: { stake: number; is_friendly?: boolean }) {
  return game.is_friendly ? "🤝 친선전" : `판돈 ${game.stake.toLocaleString("ko-KR")}점`;
}

// 최근 결과용: '10. 1. 오후 09:05 시작 · 3분 12초'
function playTime(started: string | null | undefined, finished: string | null | undefined) {
  if (!started) return "";
  const start = new Date(started);
  const text = start.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (!finished) return `${text} 시작`;
  const seconds = Math.max(0, Math.round((new Date(finished).getTime() - start.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${text} 시작 · ${minutes}분 ${rest}초`;
}

function nameOf(game: OmokRow, side: "host" | "guest" | null) {
  if (side === "host") return game.host_name;
  if (side === "guest") return game.guest_name ?? "?";
  return "?";
}

export default function OmokGame({ onClose, onBack, initialGameId, currentMemberId, myPoints, myTickets, myName, isAdmin, opponents }: Props) {
  const [games, setGames] = useState<OmokRow[]>([]);
  const [viewId, setViewId] = useState<string>(initialGameId ?? "");
  const [missing, setMissing] = useState(false);
  const [stake, setStake] = useState("100");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");

  // 카톡방 초대 메시지 (자동으로 보내지 않고 방장이 직접 누른다)
  function sendInvite(gameId: string) {
    if (!window.confirm("카톡방에 초대 메시지를 보낼까요?")) return;
    void run({ action: "invite", gameId }, () => setInfo("📣 카톡방에 초대 메시지를 보냈어요. (봇이 몇 초 안에 올립니다)"));
  }
  const [pending, setPending] = useState<Move | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastTick = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastEmoteAt = useRef(0);
  const [emote, setEmote] = useState<ShownEmote | null>(null);
  const [emoteCooldownUntil, setEmoteCooldownUntil] = useState(0);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const query = (columns: string) =>
      supabase
        .from("omok_games")
        .select(columns)
        .or(`status.in.(open,challenge,escrow,playing),finished_at.gte.${since}`)
        .order("created_at", { ascending: false })
        .limit(40);
    let { data, error } = await query(COLUMNS);
    // 새로 추가한 칸(무르기)이 DB에 아직 없으면 그 칸만 빼고 다시 불러온다 → 목록이 비지 않게
    if (error?.code === "42703") ({ data, error } = await query(COLUMNS.replace(",undo", "")));
    if (error) return;
    const rows = (data ?? []) as unknown as OmokRow[];

    // 링크로 들어온 대국이 목록에 없으면(취소·오래된 결과) 따로 불러온다
    if (initialGameId && !rows.some((row) => row.id === initialGameId)) {
      const single = await supabase.from("omok_games").select(COLUMNS).eq("id", initialGameId).maybeSingle();
      if (single.data) rows.push(single.data as OmokRow);
      else setMissing(true);
    }
    setGames(rows);
  }, [initialGameId]);

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

  // ── 종료 팝업 · 재경기 ──
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [rematchOffer, setRematchOffer] = useState<{ id: string; from: string; stake: number; friendly: boolean } | null>(null);
  const seenStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!viewing) return;
    const prev = seenStatus.current[viewing.id];
    seenStatus.current[viewing.id] = viewing.status;
    if (viewing.status !== "finished") return;
    // 보고 있는 중에 끝났거나, 방금(30초 안에) 끝난 판을 열었을 때만 팝업
    const fresh = !!viewing.finished_at && Date.now() - new Date(viewing.finished_at).getTime() < 30000;
    if ((prev && prev !== "finished") || (!prev && fresh)) setResultFor(viewing.id);
  }, [viewing?.id, viewing?.status]);

  function seatOf(game: { host_member: string; guest_member: string | null }): "host" | "guest" | null {
    if (game.host_member === currentMemberId) return "host";
    if (game.guest_member === currentMemberId) return "guest";
    return null;
  }

  async function requestRematch(game: OmokRow) {
    setResultFor(null);
    if (game.is_test) {
      await run({ action: "create_test" }, (id) => id && setViewId(id));
      return;
    }
    const opponent = game.host_member === currentMemberId ? game.guest_member : game.host_member;
    await run({ action: "create", friendly: !!game.is_friendly, stake: game.stake, targetMemberId: opponent }, (id) => {
      if (!id) return;
      // 상대 화면에 바로 재경기 신청 팝업을 띄운다 (창을 닫았으면 대기실·카톡 링크로 받는다)
      void channelRef.current?.send({
        type: "broadcast",
        event: "rematch",
        payload: { id, from: myName, to: opponent, stake: game.stake, friendly: !!game.is_friendly },
      });
      setViewId(id);
    });
  }
  const live = viewing && (viewing.status === "playing" || viewing.status === "escrow");

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), live ? 1200 : 3000);
    return () => window.clearInterval(timer);
  }, [load, live]);

  // 감정표현: 서버를 거치지 않고 실시간 채널로 주고받는다
  function showEmote(next: { kind: EmoteKind; spot: number; name: string; watcher: boolean }) {
    const key = Date.now() + Math.random();
    setEmote({ ...next, key });
    window.setTimeout(() => setEmote((current) => (current?.key === key ? null : current)), EMOTE_SHOW_MS);
  }

  function sendEmote(kind: EmoteKind, board: Board, watcher: boolean) {
    const nowMs = Date.now();
    if (nowMs - lastEmoteAt.current < EMOTE_COOLDOWN_MS) return;
    lastEmoteAt.current = nowMs;
    setEmoteCooldownUntil(nowMs + EMOTE_COOLDOWN_MS);
    const payload = { kind, spot: pickEmoteSpot(board), name: myName, watcher };
    showEmote(payload);
    void channelRef.current?.send({ type: "broadcast", event: "emote", payload });
  }

  // 보고 있는 대국은 실시간 구독으로 바로 받는다 (주기적 확인은 끊겼을 때 대비용)
  useEffect(() => {
    if (!viewId) return;
    const channel = supabase
      .channel(`omok-${viewId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "rematch" }, ({ payload }) => {
        const data = payload as { id?: string; from?: string; to?: string; stake?: number; friendly?: boolean };
        if (!data.id || data.to !== currentMemberId) return;
        setRematchOffer({ id: data.id, from: String(data.from ?? "").slice(0, 10), stake: Number(data.stake) || 0, friendly: !!data.friendly });
      })
      .on("broadcast", { event: "emote" }, ({ payload }) => {
        const data = payload as { kind?: unknown; spot?: unknown; name?: unknown; watcher?: unknown };
        if (!isEmoteKind(data.kind)) return;
        const spot = Number(data.spot);
        showEmote({
          kind: data.kind,
          spot: Number.isInteger(spot) && spot >= 0 && spot < EMOTE_SPOTS.length ? spot : 0,
          name: String(data.name ?? "").slice(0, 10),
          watcher: data.watcher === true,
        });
      })
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "omok_games", filter: `id=eq.${viewId}` },
        (payload) => {
          const row = payload.new as OmokRow;
          setGames((current) => current.map((game) => (game.id === row.id ? { ...game, ...row } : game)));
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [viewId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  // 착수: 서버 응답을 기다리지 않고 내 화면에 먼저 돌을 놓는다 (실패하면 되돌린다)
  async function playMove(gameId: string, x: number, y: number) {
    setPending(null);
    setMessage("");
    setGames((current) =>
      current.map((game) =>
        game.id === gameId ? { ...game, moves: [...game.moves, [x, y] as Move], turn_deadline: null } : game,
      ),
    );
    setBusy(true);
    const result = await callOmok({ action: "move", gameId, x, y });
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "착수하지 못했습니다.");
    await load();
  }

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
    setInfo("");
    const result = await callOmok(payload);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "실패했습니다.");
    } else {
      after?.(result.id);
    }
    await load();
  }

  const openRooms = games.filter((game) => game.status === "open" && game.host_member !== currentMemberId && !game.is_test);
  const challengesToMe = games.filter(
    (game) => game.status === "challenge" && game.target_member === currentMemberId,
  );
  const liveGames = games.filter((game) => game.status === "playing" && game.id !== myActive?.id && (!game.is_test || game.host_member === currentMemberId));
  // 테스트 대국은 최근 결과에 남기지 않는다 (관리자 본인에게도)
  const recent = games.filter((game) => game.status === "finished" && !game.is_test).slice(0, 8);

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
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        {message && <div className="omokMessage">{message}</div>}
        {info && !message && <div className="omokMessage info">{info}</div>}
        {missing && viewId === initialGameId && !viewing && (
          <div className="omokMessage">대국신청을 찾지 못했습니다. 주소를 확인해 주세요.</div>
        )}

        {viewing && (viewing.status === "open" || viewing.status === "challenge") ? (
          <div className="omokInvite">
            <span className="omokInviteIcon">⚔️</span>
            <strong>
              {viewing.status === "challenge"
                ? `${viewing.host_name}님의 대국신청`
                : `${viewing.host_name}님이 상대를 찾고 있어요`}
            </strong>
            <span>
              {viewing.is_friendly ? <b>🤝 친선전 · 점수·티켓 없음</b> : <>판돈 <b>💎 {viewing.stake.toLocaleString("ko-KR")}점</b> · 티켓 🎫1장</>} · 렌주룰 · 한 수 {TURN_SECONDS}초
            </span>
            <span className="muted">
              내 점수 💎 {myPoints !== null ? myPoints.toLocaleString("ko-KR") : "-"} · 티켓 🎫 {myTickets ?? "-"}
            </span>
            {viewing.host_member === currentMemberId ? (
              <>
                <span className="muted">내가 만든 대국입니다. 상대를 기다리는 중…</span>
                <div className="omokControls">
                  <button className="smallButton ghost" onClick={() => setViewId("")}>← 대기실</button>
                  <button className="smallButton inviteButton" disabled={busy} onClick={() => sendInvite(viewing.id)}>
                    📣 카톡방에 초대하기
                  </button>
                  <button className="smallButton ghost" disabled={busy} onClick={() => run({ action: "cancel", gameId: viewing.id }, () => setViewId(""))}>
                    취소
                  </button>
                </div>
              </>
            ) : viewing.status === "challenge" && viewing.target_member !== currentMemberId ? (
              <>
                <span className="muted">다른 회원에게 보낸 대국신청입니다.</span>
                <button className="smallButton ghost" onClick={() => setViewId("")}>← 대기실</button>
              </>
            ) : (
              <div className="omokControls">
                <button className="primaryButton" disabled={busy || !!myActive} onClick={() => run({ action: "join", gameId: viewing.id })}>
                  {viewing.status === "challenge" ? "대국 수락" : "대결하기"}
                </button>
                {viewing.status === "challenge" && (
                  <button className="smallButton ghost" disabled={busy} onClick={() => run({ action: "decline", gameId: viewing.id }, () => setViewId(""))}>
                    거절
                  </button>
                )}
                <button className="smallButton ghost" onClick={() => setViewId("")}>대기실</button>
              </div>
            )}
            {myActive && viewing.host_member !== currentMemberId && (
              <span className="muted">이미 대기 중이거나 진행 중인 대국이 있어 참여할 수 없습니다.</span>
            )}
          </div>
        ) : viewing ? (
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
            onMove={(x, y) => void playMove(viewing.id, x, y)}
            onResign={() => {
              if (window.confirm("기권하면 판돈을 잃습니다. 기권할까요?")) {
                void run({ action: "resign", gameId: viewing.id });
              }
            }}
            onCancel={() => run({ action: "cancel", gameId: viewing.id }, () => setViewId(""))}
            onUndoRequest={() => run({ action: "undo_request", gameId: viewing.id })}
            onUndoAnswer={(accept) => run({ action: "undo_answer", gameId: viewing.id, accept })}
            emote={emote}
            emoteReadyIn={Math.max(0, emoteCooldownUntil - now)}
            onEmote={sendEmote}
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
                        ? "대국신청 응답 대기 중…"
                        : myActive.status === "escrow"
                          ? "봇이 점수·티켓 확인 중…"
                          : "대국 진행 중"}
                  </strong>
                  <span>{stakeText(myActive)}</span>
                </div>
                <div className="omokCardActions">
                  {(myActive.status === "escrow" || myActive.status === "playing") && (
                    <button className="smallButton" onClick={() => setViewId(myActive.id)}>판 보기</button>
                  )}
                  {(myActive.status === "open" || myActive.status === "challenge") && !myActive.is_test && (
                    <button className="smallButton inviteButton" disabled={busy} onClick={() => sendInvite(myActive.id)}>
                      📣 초대
                    </button>
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
                  <strong>⚔️ {game.host_name}님의 대국신청</strong>
                  <span>{stakeText(game)}</span>
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
                  <button
                    className={`omokChip friendly ${stake === "friendly" ? "active" : ""}`}
                    onClick={() => setStake("friendly")}
                    title="티켓·점수 없이 두는 친선전"
                  >
                    🤝 친선
                  </button>
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
                    value={stake === "friendly" ? "" : stake}
                    placeholder={stake === "friendly" ? "친선" : ""}
                    onChange={(event) => setStake(event.target.value)}
                    aria-label="판돈"
                  />
                  <span>점</span>
                </div>
                <OpponentPicker opponents={opponents} value={target} onChange={setTarget} />
                <button
                  className="primaryButton"
                  disabled={busy}
                  onClick={() =>
                    run({
                      action: "create",
                      friendly: stake === "friendly",
                      stake: stake === "friendly" ? 0 : Number(stake),
                      targetMemberId: target || null,
                    })
                  }
                >
                  {target ? "대국신청 보내기" : "방 만들기"}
                </button>
                <small>이기면 상대 판돈을 가져가고, 비기면 돌려받습니다. 티켓은 돌려받지 않습니다.</small>
                {isAdmin && (
                  <button
                    className="smallButton ghost omokTestButton"
                    disabled={busy}
                    onClick={() => run({ action: "create_test" }, (id) => id && setViewId(id))}
                  >
                    🧪 테스트 대국 (관리자 · 혼자 양쪽 · 점수 없음)
                  </button>
                )}
              </div>
            )}

            <div className="omokSection">
              <strong>대기 중인 방</strong>
              {openRooms.length === 0 && <span className="muted">열린 방이 없습니다.</span>}
              {openRooms.map((game) => (
                <div className="omokCard" key={game.id}>
                  <div>
                    <strong>{game.host_name}</strong>
                    <span>{stakeText(game)}</span>
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
                      <span>{stakeText(game)} · {game.moves.length}수</span>
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
                    <em>
                      {stakeText(game)} · {END_TEXT[game.end_reason ?? ""] ?? ""}
                      <br />
                      {playTime(game.started_at ?? game.created_at, game.finished_at)}
                    </em>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {viewing && resultFor === viewing.id && viewing.status === "finished" && !rematchOffer && (
          <GameResultPopup
            game={viewing}
            mySeat={seatOf(viewing)}
            endText={END_TEXT}
            busy={busy}
            onClose={() => {
              setResultFor(null);
              if (seatOf(viewing)) setViewId("");
            }}
            onRematch={() => void requestRematch(viewing)}
          />
        )}
        {rematchOffer && (
          <RematchOfferPopup
            from={rematchOffer.from}
            stakeText={rematchOffer.friendly ? "🤝 친선전 · 점수·티켓 없음" : `💎 판돈 ${rematchOffer.stake.toLocaleString("ko-KR")}점 · 🎫 티켓 1장`}
            busy={busy}
            onAccept={() => {
              const offer = rematchOffer;
              setRematchOffer(null);
              setResultFor(null);
              void run({ action: "join", gameId: offer.id }, () => setViewId(offer.id));
            }}
            onDecline={() => {
              const offer = rematchOffer;
              setRematchOffer(null);
              void run({ action: "decline", gameId: offer.id });
            }}
          />
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
  onUndoRequest,
  onUndoAnswer,
  emote,
  emoteReadyIn,
  onEmote,
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
  onUndoRequest: () => void;
  onUndoAnswer: (accept: boolean) => void;
  emote: ShownEmote | null;
  emoteReadyIn: number;
  onEmote: (kind: EmoteKind, board: Board, watcher: boolean) => void;
}) {
  const board = useMemo(() => boardFromMoves(game.moves), [game.moves]);
  // 테스트 대국은 혼자 양쪽을 두므로 '지금 차례'가 내 쪽
  const testMine = !!game.is_test && game.host_member === me;
  const testTurn: "host" | "guest" =
    game.moves.length % 2 === 0 ? (game.black ?? "host") : game.black === "guest" ? "host" : "guest";
  const mySide = testMine ? testTurn : game.host_member === me ? "host" : game.guest_member === me ? "guest" : null;
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

  // ── 무르기 ──
  const realSide = game.host_member === me ? "host" : game.guest_member === me ? "guest" : null;
  const whiteOf = game.black === "host" ? "guest" : "host";
  const lastBy = game.moves.length % 2 === 1 ? game.black : whiteOf;
  const undoPending = game.undo?.pending ?? null;
  const undoUsed = realSide ? game.undo?.used?.[realSide] ?? 0 : 0;
  const canUndo =
    game.status === "playing" &&
    realSide !== null &&
    game.moves.length >= 2 &&
    !undoPending &&
    (game.is_test ? true : lastBy === realSide && undoUsed < MAX_UNDO);
  const undoIncoming = game.status === "playing" && !!undoPending && realSide !== null && undoPending.by !== realSide;
  const undoWaiting = game.status === "playing" && !!undoPending && undoPending.by === realSide;

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
    const settle = game.is_test
      ? "🧪 테스트 대국 (점수 변동 없음)"
      : game.is_friendly
        ? "🤝 친선전 (점수 변동 없음)"
      : game.settle_state === "done"
        ? "카톡 점수에 반영 완료"
        : "봇이 곧 카톡 점수에 반영합니다";
    if (game.winner === "draw") status = `🤝 무승부 · ${game.is_friendly ? "" : "판돈 반환 · "}${settle}`;
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
        <span className="omokStake">{game.is_friendly ? "🤝 친선" : `💎 ${game.stake.toLocaleString("ko-KR")}`}</span>
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

      <div className="omokStage">
      {emote && (
        <div className="omokEmotePop" key={emote.key} style={spotStyle(emote.spot)}>
          <EmoteIcon kind={emote.kind} />
          {emote.name && <span className={emote.watcher ? "watcher" : ""}>{emote.watcher ? `👀 ${emote.name}` : emote.name}</span>}
        </div>
      )}
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
      </div>

      {me && (game.status === "playing" || game.status === "finished") && (
        <div className="omokEmoteBar" role="group" aria-label="감정표현">
          {EMOTES.map((item) => (
            <button
              key={item.kind}
              className="omokEmoteButton"
              disabled={emoteReadyIn > 0}
              aria-label={item.label}
              title={item.label}
              onClick={() => onEmote(item.kind, board, mySide === null)}
            >
              <EmoteIcon kind={item.kind} />
            </button>
          ))}
          {emoteReadyIn > 0 && <em className="omokEmoteWait">{Math.ceil(emoteReadyIn / 1000)}</em>}
        </div>
      )}

      {undoIncoming && (
        <div className="omokUndoAsk" role="alert">
          <span>↩ <b>{nameOf(game, undoPending!.by)}</b>님이 방금 둔 수를 무르고 싶어 해요.</span>
          <div>
            <button className="primaryButton" disabled={busy} onClick={() => onUndoAnswer(true)}>수락</button>
            <button className="smallButton ghost" disabled={busy} onClick={() => onUndoAnswer(false)}>거절</button>
          </div>
        </div>
      )}
      {undoWaiting && <p className="omokUndoWait">↩ 무르기 요청 중… 상대의 응답을 기다리고 있어요.</p>}

      <div className="omokControls">
        <button className="smallButton ghost" onClick={onBack}>← 대기실</button>
        {canUndo && (
          <button className="smallButton ghost" disabled={busy} onClick={onUndoRequest}>
            ↩ 무르기{game.is_test ? "" : ` (${MAX_UNDO - undoUsed}회 남음)`}
          </button>
        )}
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
