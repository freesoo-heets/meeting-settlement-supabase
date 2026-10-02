"use client";

import { useGameViewport } from "./useGameViewport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  BOARD_H,
  BOARD_W,
  CELL,
  LABEL,
  MARGIN,
  MAX_STRIKES,
  RADIUS,
  TURN_SECONDS,
  VMAX,
  alive,
  simulate,
  type Piece,
  type Side,
} from "../lib/alkkagi";
import { OpponentPicker, type Opponent } from "./OmokGame";
import {
  EMOTES,
  EMOTE_COOLDOWN_MS,
  EMOTE_SHOW_MS,
  EMOTE_SPOTS,
  EmoteIcon,
  isEmoteKind,
  mirrorSpot,
  pickEmoteSpotFromPoints,
  spotStyle,
  type EmoteKind,
} from "./OmokEmotes";
import { GameResultPopup, RematchOfferPopup } from "./GameResult";

type Seat = "host" | "guest";

type AlkRow = {
  id: string;
  status: "open" | "challenge" | "escrow" | "playing" | "finished" | "cancelled";
  stake: number;
  host_member: string;
  host_name: string;
  guest_member: string | null;
  guest_name: string | null;
  target_member: string | null;
  cho: Seat | null;
  turn: Seat | null;
  pieces: Piece[];
  last_shot: { no: number; id: string; vx: number; vy: number; before: Piece[] } | null;
  shot_no: number;
  strikes: Partial<Record<Seat, number>> | null;
  turn_deadline: string | null;
  winner: Seat | "draw" | null;
  end_reason: string | null;
  escrow_state: string;
  escrow_note: string | null;
  settle_state: string;
  is_test?: boolean;
  is_friendly?: boolean;
  created_at: string;
  finished_at: string | null;
  started_at?: string | null;
};

type ShownEmote = { kind: EmoteKind; spot: number; name: string; watcher: boolean; key: number };

type Props = {
  onClose: () => void;
  onBack?: () => void;
  initialGameId?: string;
  currentMemberId: string | null;
  myName: string;
  myPoints: number | null;
  myTickets: number | null;
  opponents: Opponent[];
  isAdmin?: boolean;
};

const COLUMNS =
  "id,status,stake,host_member,host_name,guest_member,guest_name,target_member,cho,turn,pieces,last_shot,shot_no,strikes,turn_deadline,winner,end_reason,escrow_state,escrow_note,settle_state,is_test,is_friendly,created_at,started_at,finished_at";
const STAKE_PRESETS = [100, 300, 500, 1000];
const PULL_MAX = 90; // 이만큼 당기면 최대 세기 (140에서 줄임)
const AIM_GUIDE = 34; // 방향 표시 길이 (세기와 무관하게 고정)
const CANCEL_POWER = 0.18; // 이보다 덜 당긴 채 놓으면 취소 (처음 댄 자리 근처로 돌아오면 취소)
const KIND_NAME: Record<string, string> = { gung: "궁", cha: "차", po: "포", ma: "마", sang: "상", sa: "사", jol: "졸" };
const SIM_FPS = 60;
const FADE_FRAMES = 18; // 떨어진 알이 사라지는 시간 (0.3초) // 물리 계산 단위 (lib/alkkagi.ts 의 DT = 1/60)
const END_TEXT: Record<string, string> = {
  knockout: "알 전멸",
  timeout: `시간 초과 ${MAX_STRIKES}회`,
  resign: "기권",
  draw: "무승부",
};

async function callAlkkagi(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/alkkagi", {
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

function nameOf(game: AlkRow, seat: Seat | null) {
  if (seat === "host") return game.host_name;
  if (seat === "guest") return game.guest_name ?? "?";
  return "?";
}

const otherSeat = (seat: Seat): Seat => (seat === "host" ? "guest" : "host");

export default function AlkkagiGame({
  onClose,
  onBack,
  initialGameId,
  currentMemberId,
  myName,
  myPoints,
  myTickets,
  opponents,
  isAdmin,
}: Props) {
  useGameViewport(); // 휴대폰: 뒤 페이지 스크롤 막기 · 키보드 높이에 맞추기
  const [games, setGames] = useState<AlkRow[]>([]);
  const [viewId, setViewId] = useState(initialGameId ?? "");
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
  const [now, setNow] = useState(Date.now());
  const lastTick = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastEmoteAt = useRef(0);
  const [emote, setEmote] = useState<ShownEmote | null>(null);
  const [emoteCooldownUntil, setEmoteCooldownUntil] = useState(0);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("alkkagi_games")
      .select(COLUMNS)
      .or(`status.in.(open,challenge,escrow,playing),finished_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return;
    const rows = (data ?? []) as AlkRow[];
    if (initialGameId && !rows.some((row) => row.id === initialGameId)) {
      const single = await supabase.from("alkkagi_games").select(COLUMNS).eq("id", initialGameId).maybeSingle();
      if (single.data) rows.push(single.data as AlkRow);
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

  async function requestRematch(game: AlkRow) {
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
    const timer = window.setInterval(() => void load(), live ? 1500 : 3000);
    return () => window.clearInterval(timer);
  }, [load, live]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  function showEmote(next: Omit<ShownEmote, "key">) {
    const key = Date.now() + Math.random();
    setEmote({ ...next, key });
    window.setTimeout(() => setEmote((current) => (current?.key === key ? null : current)), EMOTE_SHOW_MS);
  }

  // 위치(spot)는 '판 기준'으로 주고받고, 판을 뒤집어 보는 사람은 화면에서 뒤집는다
  function sendEmote(kind: EmoteKind, pieces: Piece[], watcher: boolean) {
    const nowMs = Date.now();
    if (nowMs - lastEmoteAt.current < EMOTE_COOLDOWN_MS) return;
    lastEmoteAt.current = nowMs;
    setEmoteCooldownUntil(nowMs + EMOTE_COOLDOWN_MS);
    const spot = pickEmoteSpotFromPoints(
      pieces.filter((piece) => !piece.out).map((piece) => [piece.x / BOARD_W, piece.y / BOARD_H]),
    );
    const payload = { kind, spot, name: myName, watcher };
    showEmote(payload);
    void channelRef.current?.send({ type: "broadcast", event: "emote", payload });
  }

  useEffect(() => {
    if (!viewId) return;
    const channel = supabase
      .channel(`alkkagi-${viewId}`, { config: { broadcast: { self: false } } })
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
        { event: "UPDATE", schema: "public", table: "alkkagi_games", filter: `id=eq.${viewId}` },
        (payload) => {
          const row = payload.new as AlkRow;
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
    if (!viewing || viewing.status !== "playing" || !viewing.turn_deadline) return;
    const over = now - new Date(viewing.turn_deadline).getTime();
    if (over > 2500 && now - lastTick.current > 3000) {
      lastTick.current = now;
      void callAlkkagi({ action: "tick", gameId: viewing.id }).then(() => load());
    }
  }, [now, viewing, load]);

  async function run(payload: Record<string, unknown>, after?: (id?: string) => void) {
    setBusy(true);
    setMessage("");
    setInfo("");
    const result = await callAlkkagi(payload);
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "실패했습니다.");
    else after?.(result.id);
    await load();
  }

  const openRooms = games.filter((game) => game.status === "open" && game.host_member !== currentMemberId && !game.is_test);
  const challengesToMe = games.filter((game) => game.status === "challenge" && game.target_member === currentMemberId);
  const liveGames = games.filter((game) => game.status === "playing" && game.id !== myActive?.id && (!game.is_test || game.host_member === currentMemberId));
  // 테스트 대국은 최근 결과에 남기지 않는다 (관리자 본인에게도)
  const recent = games.filter((game) => game.status === "finished" && !game.is_test).slice(0, 8);

  return (
    <div
      className="meetingModalBackdrop gameBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal omokModal gameModal" role="dialog" aria-modal="true">
        <div className="meetingModalHeader">
          <div>
            <span>장기알 · 한 턴 {TURN_SECONDS}초 · 티켓 1장씩</span>
            <h2>🥏 알까기</h2>
          </div>
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        {message && <div className="omokMessage">{message}</div>}
        {info && !message && <div className="omokMessage info">{info}</div>}

        {viewing && (viewing.status === "open" || viewing.status === "challenge") ? (
          <div className="omokInvite">
            <span className="omokInviteIcon">🥏</span>
            <strong>
              {viewing.status === "challenge"
                ? `${viewing.host_name}님의 알까기 대국신청`
                : `${viewing.host_name}님이 알까기 상대를 찾고 있어요`}
            </strong>
            <span>
              {viewing.is_friendly ? <b>🤝 친선전 · 점수·티켓 없음</b> : <>판돈 <b>💎 {viewing.stake.toLocaleString("ko-KR")}점</b> · 티켓 🎫1장</>} · 한 턴 {TURN_SECONDS}초
            </span>
            <span className="muted">
              내 점수 💎 {myPoints !== null ? myPoints.toLocaleString("ko-KR") : "-"} · 티켓 🎫 {myTickets ?? "-"}
            </span>
            {viewing.host_member === currentMemberId ? (
              <div className="omokControls">
                <button className="smallButton ghost" onClick={() => setViewId("")}>← 대기실</button>
                <button className="smallButton inviteButton" disabled={busy} onClick={() => sendInvite(viewing.id)}>
                  📣 카톡방에 초대하기
                </button>
                <button className="smallButton ghost" disabled={busy} onClick={() => run({ action: "cancel", gameId: viewing.id }, () => setViewId(""))}>
                  취소
                </button>
              </div>
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
          </div>
        ) : viewing ? (
          <AlkkagiBoardView
            game={viewing}
            me={currentMemberId}
            now={now}
            busy={busy}
            onBack={() => setViewId("")}
            onShoot={async (pieceId, vx, vy) => {
              setBusy(true);
              setMessage("");
              const result = await callAlkkagi({ action: "shoot", gameId: viewing.id, pieceId, vx, vy });
              setBusy(false);
              if (!result.ok) setMessage(result.error ?? "튕기지 못했습니다.");
              await load();
              return result.ok;
            }}
            onResign={() => {
              if (window.confirm("기권하면 판돈을 잃습니다. 기권할까요?")) void run({ action: "resign", gameId: viewing.id });
            }}
            onCancel={() => run({ action: "cancel", gameId: viewing.id }, () => setViewId(""))}
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
                <strong>새 알까기</strong>
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
                <small>상대 알을 모두 판 밖으로 떨어뜨리면 승리. 이기면 상대 판돈을 가져갑니다.</small>
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
                      <span>{stakeText(game)} · {game.shot_no}수</span>
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
            ratingKind="alkkagi"
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

function AlkkagiBoardView({
  game,
  me,
  now,
  busy,
  onBack,
  onShoot,
  onResign,
  onCancel,
  emote,
  emoteReadyIn,
  onEmote,
}: {
  game: AlkRow;
  me: string | null;
  now: number;
  busy: boolean;
  onBack: () => void;
  onShoot: (pieceId: string, vx: number, vy: number) => Promise<boolean>;
  onResign: () => void;
  onCancel: () => void;
  emote: ShownEmote | null;
  emoteReadyIn: number;
  onEmote: (kind: EmoteKind, pieces: Piece[], watcher: boolean) => void;
}) {
  // 테스트 대국은 혼자 양쪽을 치므로 '지금 차례'가 내 쪽
  const testMine = !!game.is_test && game.host_member === me;
  const mySeat: Seat | null = testMine
    ? game.turn ?? "host"
    : game.host_member === me
      ? "host"
      : game.guest_member === me
        ? "guest"
        : null;
  const choSeat = game.cho;
  const hanSeat = choSeat ? otherSeat(choSeat) : null;
  const myColor: Side | null = mySeat ? (mySeat === choSeat ? "cho" : "han") : null;
  const flipped = !testMine && myColor === "han"; // 내 알이 항상 아래쪽에 오도록 (테스트는 고정)
  const myTurn = game.status === "playing" && mySeat !== null && game.turn === mySeat;

  // 화면에 그릴 알 위치 (애니메이션 중에는 계산 중간값)
  const [shown, setShown] = useState<Piece[]>(game.pieces);
  const [animating, setAnimating] = useState(false);
  const animatedNo = useRef(game.shot_no);
  const frameRef = useRef(0);

  // 움직이는 동안에는 판 위에 캔버스를 올려 알을 그린다.
  // (SVG 알 32개와 한자를 매 순간 다시 그리면 휴대폰에서 끊기기 때문)
  const animCanvas = useRef<HTMLCanvasElement | null>(null);
  const flippedRef = useRef(flipped);
  flippedRef.current = flipped;

  const play = useCallback((before: Piece[], shot: { id: string; vx: number; vy: number }, final: Piece[] | null) => {
    const frames: Piece[][] = [before];
    const result = simulate(before, shot, (state) => frames.push(state));
    window.cancelAnimationFrame(frameRef.current);
    setShown(before);
    setAnimating(true);

    const canvas = animCanvas.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      setShown(final ?? result);
      setAnimating(false);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const scale = canvas.width / BOARD_W;
    const flip = flippedRef.current;

    // 판 밖으로 나간 순간을 기억해 서서히 사라지게 한다
    const outAt = new Map<string, number>();
    frames.forEach((frame, index) => {
      frame.forEach((piece) => {
        if (piece.out && !outAt.has(piece.id) && !before.find((b) => b.id === piece.id)?.out) outAt.set(piece.id, index);
      });
    });

    // t(물리 계산 단위 시각)의 장면을 캔버스에 그린다
    const last = frames.length - 1;
    const drawAt = (t: number) => {
      const index = Math.floor(t);
      const i = Math.min(index, last);
      const frac = index >= last ? 0 : t - index;
      const a = frames[i];
      const b = frames[Math.min(i + 1, last)];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (let k = 0; k < a.length; k += 1) {
        const piece = a[k];
        let alpha = 1;
        const gone = outAt.get(piece.id);
        if (piece.out || b[k].out) {
          if (gone === undefined) continue; // 원래 나가 있던 알
          alpha = Math.max(0, 1 - (t - gone) / FADE_FRAMES);
          if (alpha <= 0) continue;
        }
        const x = piece.x + (b[k].x - piece.x) * frac;
        const y = piece.y + (b[k].y - piece.y) * frac;
        drawPiece(ctx, piece, flip ? BOARD_W - x : x, flip ? BOARD_H - y : y, alpha);
      }
    };

    // ★ 깜빡임 방지 1: 원래 판의 알을 숨기기 전에 캔버스에 첫 장면부터 그려 둔다
    drawAt(0);

    let startedAt = 0;
    const step = (time: number) => {
      if (!startedAt) startedAt = time;
      // 실제 흐른 시간 기준 (물리 계산은 1/60초 단위) → 화면 주사율과 상관없이 같은 속도
      const t = ((time - startedAt) / 1000) * SIM_FPS;
      const fadeDone = [...outAt.values()].every((at) => t - at > FADE_FRAMES);
      if (t >= last && fadeDone) {
        // ★ 깜빡임 방지 2: 캔버스는 마지막 장면 그대로 두고, 원래 판의 알이 다시 그려진 뒤에 지운다
        drawAt(last + FADE_FRAMES + 1);
        setShown(final ?? result);
        setAnimating(false);
        return;
      }
      drawAt(t);
      frameRef.current = window.requestAnimationFrame(step);
    };
    frameRef.current = window.requestAnimationFrame(step);
  }, []);

  // 원래 판의 알이 다시 보이게 된 다음 화면에서 캔버스를 비운다
  useEffect(() => {
    if (animating) return;
    const id = window.requestAnimationFrame(() => {
      const canvas = animCanvas.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    return () => window.cancelAnimationFrame(id);
  }, [animating]);

  // 서버에서 새 수가 오면 재생한다 (내가 쏜 것은 이미 재생했으므로 건너뜀)
  useEffect(() => {
    const shot = game.last_shot;
    if (shot && shot.no > animatedNo.current && Array.isArray(shot.before)) {
      animatedNo.current = shot.no;
      play(shot.before, shot, game.pieces);
    } else if (!animating) {
      setShown(game.pieces);
    }
  }, [game.last_shot?.no, game.pieces]);

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  // ── 조준 (새총: 내 알을 잡고 뒤로 당겼다 놓기) ──
  // 손가락을 움직이는 동안에는 React 상태를 바꾸지 않고 조준선·알·세기 막대만 직접 움직인다.
  // (예전에는 움직일 때마다 판 전체를 다시 그려서 조준이 손을 늦게 따라왔다)
  const layerRef = useRef<SVGGElement | null>(null);
  // x,y: 알 위치 / sx,sy: 손가락을 처음 댄 곳 / px,py: 지금 손가락 위치
  const aimRef = useRef<{ id: string; px: number; py: number; x: number; y: number; sx: number; sy: number } | null>(null);
  // ★ 휴대폰 베젤 대응: 알을 톡 눌러 고른 뒤, 판 아무 곳에서나 당겨 조준할 수 있다
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [aimId, setAimId] = useState<string | null>(null);
  const pieceEls = useRef(new Map<string, SVGGElement>());
  const pullEl = useRef<SVGLineElement | null>(null);
  const shotEl = useRef<SVGLineElement | null>(null);
  const headEl = useRef<SVGCircleElement | null>(null);
  const powerEl = useRef<HTMLDivElement | null>(null);
  const powerLabelEl = useRef<HTMLSpanElement | null>(null);
  const cancelEl = useRef<SVGCircleElement | null>(null);
  const aimFrame = useRef(0);

  function toBoard(event: React.PointerEvent) {
    const layer = layerRef.current;
    const svg = layer?.ownerSVGElement;
    const matrix = layer?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }

  function aimVector() {
    const aim = aimRef.current;
    if (!aim) return null;
    // 새총: 끈 방향의 반대로 날아간다
    const dx = aim.sx - aim.px;
    const dy = aim.sy - aim.py;
    const length = Math.hypot(dx, dy);
    const power = Math.min(length, PULL_MAX) / PULL_MAX;
    return length > 0 ? { nx: dx / length, ny: dy / length, power } : { nx: 0, ny: 0, power: 0 };
  }

  function drawAim() {
    aimFrame.current = 0;
    const aim = aimRef.current;
    const v = aimVector();
    if (!aim || !v) return;
    const cancel = v.power < CANCEL_POWER;
    const color = cancel ? "#94a3b8" : v.power < 0.4 ? "#22c55e" : v.power < 0.75 ? "#f59e0b" : "#ef4444";
    // 처음 댄 자리의 '취소' 원 (이 안으로 돌아오면 취소)
    if (cancelEl.current) {
      cancelEl.current.setAttribute("cx", aim.sx.toFixed(2));
      cancelEl.current.setAttribute("cy", aim.sy.toFixed(2));
      cancelEl.current.setAttribute("r", (CANCEL_POWER * PULL_MAX).toFixed(1));
      cancelEl.current.classList.toggle("active", cancel);
    }
    if (powerLabelEl.current) {
      powerLabelEl.current.textContent = cancel ? "놓으면 취소" : `세기 ${Math.round(v.power * 100)}%`;
    }
    // 알이 당기는 쪽으로 살짝 딸려 온다 (최대 9)
    const pull = v.power * 9;
    const ax = aim.x - v.nx * pull;
    const ay = aim.y - v.ny * pull;
    pieceEls.current.get(aim.id)?.setAttribute("transform", `translate(${ax.toFixed(2)} ${ay.toFixed(2)})`);
    const pullLine = pullEl.current;
    if (pullLine) {
      pullLine.setAttribute("x1", ax.toFixed(2));
      pullLine.setAttribute("y1", ay.toFixed(2));
      // 줄은 최대 세기 길이까지만 늘어난다 (손을 더 멀리 끌어도 판을 가로지르지 않게)
      const reach = v.power * PULL_MAX;
      pullLine.setAttribute("x2", (aim.x - v.nx * reach).toFixed(2));
      pullLine.setAttribute("y2", (aim.y - v.ny * reach).toFixed(2));
      pullLine.style.stroke = color;
      pullLine.style.opacity = v.power > 0 ? "1" : "0";
    }
    const tx = ax + v.nx * AIM_GUIDE;
    const ty = ay + v.ny * AIM_GUIDE;
    if (shotEl.current) {
      shotEl.current.setAttribute("x1", ax.toFixed(2));
      shotEl.current.setAttribute("y1", ay.toFixed(2));
      shotEl.current.setAttribute("x2", tx.toFixed(2));
      shotEl.current.setAttribute("y2", ty.toFixed(2));
      shotEl.current.style.stroke = color;
      shotEl.current.style.opacity = cancel ? "0" : "1";
    }
    if (headEl.current) {
      headEl.current.setAttribute("cx", tx.toFixed(2));
      headEl.current.setAttribute("cy", ty.toFixed(2));
      headEl.current.style.fill = color;
      headEl.current.style.opacity = cancel ? "0" : "1";
    }
    if (powerEl.current) {
      powerEl.current.style.width = `${Math.round(v.power * 100)}%`;
      powerEl.current.style.background = color;
    }
  }

  function scheduleAim() {
    if (!aimFrame.current) aimFrame.current = window.requestAnimationFrame(drawAim);
  }

  useEffect(() => {
    if (aimId) drawAim();
  }, [aimId]);

  function resetAimPiece() {
    const aim = aimRef.current;
    if (aim) pieceEls.current.get(aim.id)?.setAttribute("transform", `translate(${aim.x} ${aim.y})`);
  }

  useEffect(() => {
    if (!myTurn) setPickedId(null);
  }, [myTurn]);

  async function release() {
    const current = aimRef.current;
    const v = aimVector();
    window.cancelAnimationFrame(aimFrame.current);
    aimFrame.current = 0;
    resetAimPiece();
    aimRef.current = null;
    setAimId(null);
    if (current && (!v || v.power < CANCEL_POWER)) {
      setPickedId(current.id); // 톡 눌렀다 뗌 → 이 알을 골라 둔다 (판 아무 데서나 당길 수 있게)
      return;
    }
    if (!current || !v) return;
    setPickedId(null);
    const vx = v.nx * v.power * VMAX;
    const vy = v.ny * v.power * VMAX;
    // 응답을 기다리지 않고 바로 재생한다
    animatedNo.current = game.shot_no + 1;
    play(game.pieces, { id: current.id, vx, vy }, null);
    const ok = await onShoot(current.id, vx, vy);
    if (!ok) {
      animatedNo.current = game.shot_no;
      window.cancelAnimationFrame(frameRef.current);
      setAnimating(false);
      setShown(game.pieces);
    }
  }

  const remaining = game.turn_deadline
    ? Math.max(0, Math.ceil((new Date(game.turn_deadline).getTime() - now) / 1000))
    : TURN_SECONDS;
  const strikes = { host: 0, guest: 0, ...(game.strikes ?? {}) };
  const choAlive = alive(shown, "cho");
  const hanAlive = alive(shown, "han");

  let status = "";
  if (game.status === "escrow") status = "🤖 봇이 점수·티켓을 확인하고 있습니다… (보통 10초 이내)";
  else if (game.status === "playing") {
    status = myTurn
      ? `내 차례 · ${remaining}초 · 내 알을 뒤로 끌었다 놓으세요`
      : `${nameOf(game, game.turn)}님 차례 · ${remaining}초`;
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
      const mine = mySeat ? (game.winner === mySeat ? "🎉 승리! " : "😢 패배 · ") : "";
      status = `${mine}🏆 ${nameOf(game, game.winner)} 승 (${END_TEXT[game.end_reason ?? ""] ?? ""}) · ${settle}`;
    }
  } else if (game.status === "cancelled") {
    status = game.escrow_note ? `취소됨 · ${game.escrow_note}` : "취소된 대국입니다.";
  }

  const shownSpot = emote ? (flipped ? mirrorSpot(emote.spot) : emote.spot) : 0;

  return (
    <div className="omokGame">
      <div className="omokPlayers">
        <div className={`omokPlayer ${game.status === "playing" && game.turn === choSeat ? "turn" : ""}`}>
          <i className="alkIcon cho">楚</i>
          <strong>{nameOf(game, choSeat)}</strong>
          <em className="alkCount">{choAlive}</em>
          {mySeat === choSeat && <em>나</em>}
        </div>
        <span className="omokStake">{game.is_friendly ? "🤝 친선" : `💎 ${game.stake.toLocaleString("ko-KR")}`}</span>
        <div className={`omokPlayer ${game.status === "playing" && game.turn === hanSeat ? "turn" : ""}`}>
          <i className="alkIcon han">漢</i>
          <strong>{nameOf(game, hanSeat)}</strong>
          <em className="alkCount">{hanAlive}</em>
          {mySeat === hanSeat && <em>나</em>}
        </div>
      </div>

      {game.status === "playing" && (
        <div className="omokTimer">
          <div className={remaining <= 5 ? "urgent" : ""} style={{ width: `${(remaining / TURN_SECONDS) * 100}%` }} />
        </div>
      )}
      <p className={`omokStatus ${myTurn ? "mine" : ""}`}>{status}</p>
      {game.status === "playing" && (strikes.host > 0 || strikes.guest > 0) && (
        <p className="alkStrikes">
          시간 초과 · {game.host_name} {strikes.host}/{MAX_STRIKES} · {game.guest_name ?? "?"} {strikes.guest}/{MAX_STRIKES}
        </p>
      )}

      <div className="omokStage alkStage">
        {emote && (
          <div className="omokEmotePop" key={emote.key} style={spotStyle(shownSpot)}>
            <EmoteIcon kind={emote.kind} />
            {emote.name && <span className={emote.watcher ? "watcher" : ""}>{emote.watcher ? `👀 ${emote.name}` : emote.name}</span>}
          </div>
        )}
        <svg
          className={`alkBoard ${animating ? "animating" : ""}`}
          data-lock-scroll="true"
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          role="img"
          aria-label="알까기 판"
          onPointerDown={(event) => {
            // 알이 아닌 곳을 눌렀을 때: 골라 둔 내 알이 있으면 그 알로 조준 시작
            if (aimRef.current || !pickedId || !myTurn || animating || busy) return;
            const piece = shown.find((item) => item.id === pickedId && !item.out && item.side === myColor);
            if (!piece) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = toBoard(event);
            if (!point) return;
            aimRef.current = { id: piece.id, x: piece.x, y: piece.y, sx: point.x, sy: point.y, px: point.x, py: point.y };
            setAimId(piece.id);
          }}
          onPointerMove={(event) => {
            const aim = aimRef.current;
            if (!aim) return;
            const point = toBoard(event);
            if (!point) return;
            aim.px = point.x;
            aim.py = point.y;
            scheduleAim();
          }}
          onPointerUp={() => void release()}
          onPointerCancel={() => {
            resetAimPiece();
            aimRef.current = null;
            setAimId(null);
          }}
        >
          <g ref={layerRef} transform={flipped ? `rotate(180 ${BOARD_W / 2} ${BOARD_H / 2})` : undefined}>
            <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="12" className="alkBoardBg" />
            {Array.from({ length: 10 }, (_, row) => (
              <line key={`r${row}`} className="alkLine" x1={MARGIN} y1={MARGIN + row * CELL} x2={MARGIN + 8 * CELL} y2={MARGIN + row * CELL} />
            ))}
            {Array.from({ length: 9 }, (_, col) => (
              <line key={`c${col}`} className="alkLine" x1={MARGIN + col * CELL} y1={MARGIN} x2={MARGIN + col * CELL} y2={MARGIN + 9 * CELL} />
            ))}
            {[0, 7].map((top) => (
              <g key={`p${top}`} className="alkLine">
                <line x1={MARGIN + 3 * CELL} y1={MARGIN + top * CELL} x2={MARGIN + 5 * CELL} y2={MARGIN + (top + 2) * CELL} />
                <line x1={MARGIN + 5 * CELL} y1={MARGIN + top * CELL} x2={MARGIN + 3 * CELL} y2={MARGIN + (top + 2) * CELL} />
              </g>
            ))}

            {shown
              .filter((piece) => !piece.out)
              .map((piece) => {
                const r = RADIUS[piece.kind];
                const mine = myTurn && !animating && !busy && piece.side === myColor;
                const selected = aimId === piece.id || (!aimId && pickedId === piece.id && myTurn);
                return (
                  <g
                    key={piece.id}
                    ref={(el) => {
                      if (el) pieceEls.current.set(piece.id, el);
                      else pieceEls.current.delete(piece.id);
                    }}
                    transform={`translate(${piece.x} ${piece.y})`}
                    className={`alkPiece ${piece.side} ${mine ? "mine" : ""} ${selected ? "selected" : ""}`}
                    onPointerDown={(event) => {
                      if (!mine) return;
                      event.preventDefault();
                      event.stopPropagation(); // 판 빈 곳 조준과 겹치지 않게
                      (event.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture(event.pointerId);
                      const point = toBoard(event);
                      const sx = point?.x ?? piece.x;
                      const sy = point?.y ?? piece.y;
                      aimRef.current = { id: piece.id, x: piece.x, y: piece.y, sx, sy, px: sx, py: sy };
                      setAimId(piece.id);
                    }}
                  >
                    {selected && <circle r={r + 7} className="alkPickRing" />}
                    <polygon
                      points={octagon(r)}
                      className="alkPieceBody"
                    />
                    <text
                      className="alkPieceText"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={r * 1.05}
                      transform={flipped ? "rotate(180)" : undefined}
                    >
                      {LABEL[piece.side][piece.kind]}
                    </text>
                  </g>
                );
              })}

            {aimId && (
              <g className="alkAim" pointerEvents="none">
                {/* 새총 줄 (세기에 따라 초록 → 주황 → 빨강) */}
                <circle ref={cancelEl} className="alkCancelRing" r="0" />
                <line ref={pullEl} className="alkPull" />
                {/* 방향만 짧게 보여준다 (얼마나 멀리 갈지는 감으로) */}
                <line ref={shotEl} className="alkShot" />
                <circle ref={headEl} r="4" className="alkShotHead" />
              </g>
            )}
          </g>
        </svg>
        <canvas ref={animCanvas} className="alkAnim" aria-hidden="true" />
        {aimId && (
          <div className="alkPower">
            <div ref={powerEl} style={{ width: "0%" }} />
            <span ref={powerLabelEl} className="alkPowerLabel">놓으면 취소</span>
          </div>
        )}
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
              onClick={() => onEmote(item.kind, shown, mySeat === null)}
            >
              <EmoteIcon kind={item.kind} />
            </button>
          ))}
          {emoteReadyIn > 0 && <em className="omokEmoteWait">{Math.ceil(emoteReadyIn / 1000)}</em>}
        </div>
      )}

      <div className="omokControls">
        <button className="smallButton ghost" onClick={onBack}>← 대기실</button>
        {game.status === "playing" && mySeat && (
          <button className="smallButton ghost danger" disabled={busy} onClick={onResign}>기권</button>
        )}
        {game.status === "escrow" && mySeat && game.escrow_state === "requested" && (
          <button className="smallButton ghost" disabled={busy} onClick={onCancel}>취소</button>
        )}
      </div>
      {myTurn && (
        <small className="muted omokHint">
          {pickedId
            ? `선택: ${(() => {
                const picked = shown.find((piece) => piece.id === pickedId);
                return picked ? `${LABEL[picked.side][picked.kind]} (${KIND_NAME[picked.kind]})` : "";
              })()} — 판 아무 곳이나 누른 채 뒤로 당겼다 놓으세요. 처음 자리로 돌아와 놓으면 취소.`
            : "내 알을 누른 채 뒤로 당겼다 놓으세요. 처음 자리로 돌아와 놓으면 취소. 화면 끝이 가까우면 알을 톡 눌러 고른 뒤 판 아무 곳에서나 당겨도 됩니다."}
        </small>
      )}
    </div>
  );
}

function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece, x: number, y: number, alpha: number) {
  const r = RADIUS[piece.kind];
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#fbf1dc";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#6b4a1f";
  ctx.stroke();
  ctx.fillStyle = piece.side === "cho" ? "#15803d" : "#b91c1c";
  ctx.font = `800 ${(r * 1.05).toFixed(1)}px "Noto Serif KR", Batang, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(LABEL[piece.side][piece.kind], x, y + 1);
  ctx.globalAlpha = 1;
}

function octagon(r: number) {
  const points: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    points.push(`${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`);
  }
  return points.join(" ");
}
