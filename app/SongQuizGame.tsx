"use client";

import { copyInviteLink } from "./copyInvite";
import { useGameViewport } from "./useGameViewport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  CLIP_OFFSET,
  MAX_PLAYERS,
  REVEAL_SECONDS,
  SONG_COUNTS,
  STAGES,
  TICKETS_PER_SONG,
  TOPIC_PRESETS,
  stagePoints,
  topicLabel,
} from "../lib/songQuiz";

// 🎧 노래 맞추기 (방 + 여러 곡 연속 · 카톡 !노래퀴즈 와 같은 규칙)

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
  stage: number;
  phase: "intro" | "listen" | "reveal" | null;
  phase_deadline: string | null;
  hint_artist: string | null;
  hint_title: string | null;
  reveal_title: string | null;
  reveal_artist: string | null;
  reveal_art: string | null;
  last_winner: string | null;
  last_points: number | null;
  scores: Record<string, number>;
  escrow_state: string;
  reject_reason: string | null;
  cost: number;
  is_test: boolean;
  play_no: number;
  created_at: string;
  updated_at: string;
};

type ChatLine = { key: number; name: string; text: string; kind?: "system" | "wrong" };

type Props = {
  onClose: () => void;
  onBack?: () => void;
  initialRoomId?: string;
  currentMemberId: string | null;
  myName: string;
  isAdmin?: boolean;
};

const COLUMNS =
  "id,status,host_member,host_name,players,max_players,topic,song_total,song_no,stage,phase,phase_deadline,hint_artist,hint_title,reveal_title,reveal_artist,reveal_art,last_winner,last_points,scores,escrow_state,reject_reason,cost,is_test,play_no,created_at,updated_at";
const HOST_HANDOFF_MS = 30_000;

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function callSong(payload: Record<string, unknown>) {
  const auth = await token();
  if (!auth) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/song", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as {
    ok: boolean;
    error?: string;
    id?: string;
    correct?: boolean;
    points?: number;
    noPoints?: boolean;
  };
}

export default function SongQuizGame({ onClose, onBack, initialRoomId, currentMemberId, myName, isAdmin }: Props) {
  useGameViewport();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState(initialRoomId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("song_rooms")
      .select(COLUMNS)
      .or(`status.in.(waiting,escrow,playing),updated_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      if (/song_rooms/.test(error.message)) setMessage("노래 맞추기 설정이 아직 안 됐어요. (운영진: SQL 실행 필요)");
      return;
    }
    const rows = (data ?? []) as Room[];
    if (initialRoomId && !rows.some((row) => row.id === initialRoomId)) {
      const single = await supabase.from("song_rooms").select(COLUMNS).eq("id", initialRoomId).maybeSingle();
      if (single.data) rows.push(single.data as Room);
    }
    setRooms(rows);
  }, [initialRoomId]);

  useEffect(() => {
    void callSong({ action: "cleanup" }).then(() => load());
  }, [load]);

  const myRoom = useMemo(
    () =>
      rooms.find(
        (room) => ["waiting", "escrow", "playing"].includes(room.status) && room.players.some((player) => player.id === currentMemberId),
      ) ?? null,
    [rooms, currentMemberId],
  );
  useEffect(() => {
    if (myRoom) setRoomId((current) => current || myRoom.id);
  }, [myRoom]);

  const room = rooms.find((item) => item.id === roomId) ?? null;
  const live = room?.status === "playing" || room?.status === "escrow";
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), live ? 2000 : 3000);
    return () => window.clearInterval(timer);
  }, [load, live]);

  async function run(payload: Record<string, unknown>, after?: (id?: string, result?: { noPoints?: boolean }) => void) {
    setBusy(true);
    setMessage("");
    setInfo("");
    const result = await callSong(payload);
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "실패했습니다.");
    else after?.(result.id, result);
    await load();
  }

  const openRooms = rooms.filter(
    (item) =>
      ["waiting", "escrow", "playing"].includes(item.status) &&
      (!item.is_test || item.players.some((player) => player.id === currentMemberId)),
  );

  return (
    <div
      className="meetingModalBackdrop gameBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal catchModal gameModal" role="dialog" aria-modal="true">
        <div className="meetingModalHeader">
          <div>
            <span>최대 {MAX_PLAYERS}명 · 곡당 티켓 {TICKETS_PER_SONG}장(방장) · 정답 최대 {stagePoints(0)}점</span>
            <h2>🎧 노래 맞추기</h2>
          </div>
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        {message && <div className="omokMessage">{message}</div>}
        {info && !message && <div className="omokMessage info">{info}</div>}

        {room ? (
          <SongRoomView
            key={room.id}
            room={room}
            me={currentMemberId}
            myName={myName}
            busy={busy}
            onReload={load}
            onBack={() => setRoomId("")}
            onJoin={() =>
              run({ action: "join", roomId: room.id }, (_, result) => {
                if (result?.noPoints) setInfo("카톡 점수판에서 회원님을 찾지 못해, 맞혀도 점수는 쌓이지 않아요.");
              })
            }
            onLeave={() => run({ action: "leave", roomId: room.id }, () => setRoomId(""))}
            onStart={() => run({ action: "start", roomId: room.id })}
            onEnd={() => {
              if (!window.confirm("지금 끝낼까요? 못 낸 곡 몫 티켓은 돌려드려요.")) return;
              void run({ action: "end", roomId: room.id });
            }}
            onSettings={(topic, songTotal) => run({ action: "settings", roomId: room.id, topic, songTotal })}
            onRestart={async () => {
              const first = await callSong({ action: "restart", roomId: room.id });
              if (first.ok) await load();
              else if (/정리 중/.test(first.error ?? "")) setMessage(first.error ?? "");
              else await run({ action: "join", roomId: room.id });
            }}
            onCopyLink={() => void copyInviteLink("song", room.id).then(setInfo)}
            onRecruit={() => {
              if (!window.confirm("카톡방에 참가자 모집 알림을 보낼까요?")) return;
              void run({ action: "recruit", roomId: room.id }, () => setInfo("📣 카톡방에 모집 알림을 보냈어요. (봇이 몇 초 안에 올립니다)"));
            }}
          />
        ) : (
          <div className="omokLobby">
            {!myRoom && (
              <div className="omokCreate">
                <strong>새 방</strong>
                <button className="primaryButton" disabled={busy} onClick={() => run({ action: "create" }, (id) => id && setRoomId(id))}>
                  노래 맞추기 방 만들기
                </button>
                <small>
                  혼자서도, 여럿이서도 할 수 있어요. 방장이 주제와 곡 수를 고르고 시작하면 곡당 티켓 {TICKETS_PER_SONG}장이 들어요 (운영진 무료).
                  먼저 맞힌 사람이 카톡 점수판 점수를 받아요.
                </small>
                {isAdmin && (
                  <button className="smallButton ghost omokTestButton" disabled={busy} onClick={() => run({ action: "create_test" }, (id) => id && setRoomId(id))}>
                    🧪 테스트 방 (관리자 · 티켓 · 점수 없음)
                  </button>
                )}
              </div>
            )}
            <div className="omokSection">
              <strong>열린 방</strong>
              {openRooms.length === 0 && <span className="muted">열린 방이 없습니다.</span>}
              {openRooms.map((item) => (
                <div className={`omokCard ${item.id === myRoom?.id ? "highlight" : ""}`} key={item.id}>
                  <div>
                    <strong>{item.host_name}님의 방 · {topicLabel(item.topic)}</strong>
                    <span>
                      {item.status === "waiting" ? "대기 중" : item.status === "escrow" ? "시작 준비 중" : `${Math.min(item.song_no + 1, item.song_total)}/${item.song_total}곡`} ·{" "}
                      {item.players.length}/{item.max_players}명 · {item.players.map((player) => player.name).join(", ")}
                    </span>
                  </div>
                  <button className="smallButton" onClick={() => setRoomId(item.id)}>
                    {item.id === myRoom?.id ? "돌아가기" : "들어가기"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SongRoomView({
  room,
  me,
  myName,
  busy,
  onReload,
  onBack,
  onJoin,
  onLeave,
  onStart,
  onEnd,
  onSettings,
  onRecruit,
  onCopyLink,
  onRestart,
}: {
  room: Room;
  me: string | null;
  myName: string;
  busy: boolean;
  onReload: () => Promise<void>;
  onBack: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onStart: () => void;
  onEnd: () => void;
  onSettings: (topic: string, songTotal: number) => void;
  onRecruit: () => void;
  onCopyLink: () => void;
  onRestart: () => void;
}) {
  const joined = room.players.some((player) => player.id === me);
  const isHost = room.host_member === me;
  const [now, setNow] = useState(Date.now());
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTick = useRef(0);
  const presentRef = useRef<Set<string>>(new Set());
  const presenceReadyRef = useRef(false);
  const joinedRef = useRef(false);
  const absentSince = useRef<Record<string, number>>({});
  const handing = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [typing, setTyping] = useState(false);
  const blurTimer = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const addChat = useCallback((line: Omit<ChatLine, "key">) => {
    setChat((current) => [...current.slice(-60), { ...line, key: Date.now() + Math.random() }]);
  }, []);

  // ── 소리 ──
  //  음원은 서버에서 받아(애플 주소를 숨기려고) 곡마다 한 번만 받아 둔다.
  //  휴대폰은 처음 한 번은 손으로 눌러야 소리가 나서, 막히면 '눌러서 듣기' 단추를 보여 준다.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<{ key: string; url: string } | null>(null);
  const stopTimer = useRef(0);
  const [blocked, setBlocked] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playingClip, setPlayingClip] = useState(false);
  const [audioError, setAudioError] = useState("");
  const songKey = `${room.id}:${room.play_no}:${room.song_no}`;

  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
    return () => {
      audioRef.current?.pause();
      window.clearTimeout(stopTimer.current);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current.url);
    };
  }, []);

  const ensureAudio = useCallback(async () => {
    if (blobRef.current?.key === songKey) return blobRef.current.url;
    setLoadingAudio(true);
    try {
      const response = await fetch("/api/song", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ action: "audio", roomId: room.id, songNo: room.song_no }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? `음원 오류 ${response.status}`);
      }
      const blob = await response.blob();
      if (blobRef.current) URL.revokeObjectURL(blobRef.current.url);
      blobRef.current = { key: songKey, url: URL.createObjectURL(blob) };
      setAudioError("");
      return blobRef.current.url;
    } finally {
      setLoadingAudio(false);
    }
  }, [room.id, room.song_no, songKey]);

  const stopClip = useCallback(() => {
    window.clearTimeout(stopTimer.current);
    audioRef.current?.pause();
    setPlayingClip(false);
  }, []);

  const playClip = useCallback(
    async (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        const url = await ensureAudio();
        stopClip();
        if (audio.src !== url) audio.src = url;
        audio.currentTime = CLIP_OFFSET;
        await audio.play();
        setBlocked(false);
        setPlayingClip(true);
        stopTimer.current = window.setTimeout(stopClip, seconds * 1000);
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") setBlocked(true);
        else setAudioError(error instanceof Error ? error.message : "음원을 재생하지 못했어요.");
      }
    },
    [ensureAudio, stopClip],
  );

  const stage = STAGES[Math.min(room.stage, STAGES.length - 1)];
  const listening = room.status === "playing" && room.phase === "listen";
  const revealing = room.status === "playing" && room.phase === "reveal";

  // 단계가 바뀌면 그 길이만큼 자동으로 들려준다 · 정답 공개 때는 길게
  const autoKey = `${songKey}:${room.phase}:${room.stage}`;
  const lastAuto = useRef("");
  useEffect(() => {
    if (lastAuto.current === autoKey) return;
    lastAuto.current = autoKey;
    if (listening && STAGES[room.stage]) void playClip(STAGES[room.stage].clip);
    else if (revealing) void playClip(REVEAL_SECONDS - 1);
    else stopClip();
  }, [autoKey, listening, revealing, room.stage, playClip, stopClip]);

  // 다음 곡을 미리 받지는 않는다 (곡이 바뀌어야 서버가 내준다) — 듣기 시작 전 '준비' 단계에 받아 둔다
  useEffect(() => {
    if (room.status === "playing" && room.phase === "intro") void ensureAudio().catch(() => undefined);
  }, [room.status, room.phase, ensureAudio]);

  // ── 실시간 채널 (채팅 · 접속) ──
  useEffect(() => {
    const channel = supabase
      .channel(`song-${room.id}`, { config: { broadcast: { self: false }, presence: { key: me ?? "watcher" } } })
      .on("presence", { event: "sync" }, () => {
        presentRef.current = new Set(Object.keys(channel.presenceState()));
        presenceReadyRef.current = true;
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const data = payload as { name?: string; text?: string; wrong?: boolean };
        if (!data.text) return;
        addChat({ name: String(data.name ?? "").slice(0, 10), text: String(data.text).slice(0, 60), kind: data.wrong ? "wrong" : undefined });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "song_rooms", filter: `id=eq.${room.id}` }, () => void onReload())
      .subscribe((state) => {
        if (state === "SUBSCRIBED" && joinedRef.current && me) void channel.track({ at: Date.now() });
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [room.id, me, addChat, onReload]);

  useEffect(() => {
    joinedRef.current = joined;
    if (joined && me) void channelRef.current?.track({ at: Date.now() });
    else void channelRef.current?.untrack();
  }, [joined, me]);

  // 대기 중 방장이 30초 넘게 자리를 비우면 남은 사람에게 방장을 넘긴다
  useEffect(() => {
    if (room.status !== "waiting") return;
    const timer = window.setInterval(() => {
      if (!presenceReadyRef.current || !joinedRef.current || !me) return;
      const present = presentRef.current;
      const host = room.host_member;
      if (host === me || present.has(host)) {
        delete absentSince.current[host];
        return;
      }
      const t = Date.now();
      absentSince.current[host] ??= t;
      if (t - absentSince.current[host] < HOST_HANDOFF_MS) return;
      const next = room.players.find((player) => player.id === me || present.has(player.id));
      if (next?.id !== me || handing.current) return;
      handing.current = true;
      void callSong({ action: "take_host", roomId: room.id }).then(() => {
        handing.current = false;
        void onReload();
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [room.status, room.host_member, room.players, room.id, me, onReload]);

  // 정답 · 시간 초과 · 새 곡 알림을 채팅에 남긴다
  const lastPhaseKey = useRef("");
  useEffect(() => {
    const key = `${room.play_no}:${room.song_no}:${room.phase}:${room.stage}`;
    if (lastPhaseKey.current === key) return;
    const first = lastPhaseKey.current === "";
    lastPhaseKey.current = key;
    if (first || room.status !== "playing") return;
    if (room.phase === "reveal") {
      addChat({
        name: "",
        kind: "system",
        text: room.last_winner
          ? `🎉 ${room.last_winner}님 정답! +${room.last_points ?? 0}점 · 「${room.reveal_title}」 ${room.reveal_artist}`
          : `⏰ 아무도 못 맞혔어요 · 「${room.reveal_title}」 ${room.reveal_artist}`,
      });
    } else if (room.phase === "listen") {
      addChat({
        name: "",
        kind: "system",
        text: room.stage === 0 ? `🎵 ${room.song_no + 1}/${room.song_total}번째 곡!` : `${STAGES[room.stage].label} · 배점 ${stagePoints(room.stage)}점`,
      });
    }
  }, [room.play_no, room.song_no, room.phase, room.stage, room.status, room.last_winner, room.last_points, room.reveal_title, room.reveal_artist, room.song_total, addChat]);

  // 시간이 지나면 서버에 다음 단계로 넘겨 달라고 한다
  useEffect(() => {
    if (room.status !== "playing" || !room.phase_deadline) return;
    const over = now - new Date(room.phase_deadline).getTime();
    if (over > 1800 && now - lastTick.current > 2500) {
      lastTick.current = now;
      void callSong({ action: "tick", roomId: room.id }).then(() => onReload());
    }
  }, [now, room, onReload]);

  const remaining = room.phase_deadline ? Math.max(0, Math.ceil((new Date(room.phase_deadline).getTime() - now) / 1000)) : 0;
  const total = room.phase === "listen" ? stage.seconds : room.phase === "reveal" ? REVEAL_SECONDS : 4;

  async function submit() {
    const value = text.trim();
    if (!value || !joined) return;
    setText("");
    inputRef.current?.focus();
    if (listening) {
      const result = await callSong({ action: "guess", roomId: room.id, text: value });
      if (result.ok && result.correct) {
        void onReload();
        return;
      }
      addChat({ name: myName, text: value, kind: "wrong" });
      void channelRef.current?.send({ type: "broadcast", event: "chat", payload: { name: myName, text: value, wrong: true } });
      return;
    }
    addChat({ name: myName, text: value });
    void channelRef.current?.send({ type: "broadcast", event: "chat", payload: { name: myName, text: value } });
  }

  const ranking = [...room.players].sort((a, b) => (room.scores[b.id] ?? 0) - (room.scores[a.id] ?? 0));
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let full = vv.height;
    const onResize = () => {
      full = Math.max(full, vv.height);
      if (vv.height > full * 0.85) {
        window.clearTimeout(blurTimer.current);
        setTyping(false);
      }
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const seatsLeft = room.max_players - room.players.length;
  const canRecruit = joined && !room.is_test && seatsLeft > 0 && (room.status === "waiting" || room.status === "playing");
  const statusLabel =
    room.status === "waiting"
      ? "대기 중"
      : room.status === "escrow"
        ? "준비 중"
        : room.status === "playing"
          ? `${Math.min(room.song_no + 1, room.song_total)} / ${room.song_total}곡`
          : room.status === "finished"
            ? "게임 종료"
            : "닫힌 방";
  const cost = room.song_total * TICKETS_PER_SONG;

  return (
    <div className={`cmRoom sqRoom ${typing ? "typing" : ""}`}>
      <div className="cmTop">
        <span className={`cmPill ${room.status}`}>{room.is_test ? "🧪 " : ""}{statusLabel}</span>
        <div className="cmWord">
          {listening ? (
            <>
              <small>{stage.label} · 배점 {stagePoints(room.stage)}점</small>
              <strong>{room.hint_title ?? (room.hint_artist ? `가수 ${room.hint_artist}` : "곡 제목은?")}</strong>
            </>
          ) : revealing ? (
            <>
              <small>정답</small>
              <strong>{room.reveal_title}</strong>
            </>
          ) : room.status === "finished" ? (
            <>
              <small>최종 1위</small>
              <strong>{ranking[0]?.name ?? "-"}</strong>
            </>
          ) : (
            <>
              <small>{room.host_name}님의 방</small>
              <strong>{topicLabel(room.topic)}</strong>
            </>
          )}
        </div>
        <span className={`cmTime ${remaining <= 5 && listening ? "urgent" : ""}`}>{room.status === "playing" ? `${remaining}″` : ""}</span>
      </div>
      {room.status === "playing" && (
        <div className="cmTimer">
          <div style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }} className={remaining <= 5 && listening ? "urgent" : ""} />
        </div>
      )}

      <div className="cmMain">
        <div className="cmStage">
          <div className={`sqStage ${room.phase ?? room.status}`}>
            {room.status === "waiting" && (
              <div className="sqSetup">
                {room.reject_reason && <div className="sqReject">⚠️ {room.reject_reason}</div>}
                <strong>주제</strong>
                <div className="sqChips">
                  {TOPIC_PRESETS.map((preset) => (
                    <button
                      key={preset.value || "kpop"}
                      className={room.topic === preset.value ? "active" : ""}
                      disabled={!isHost || busy}
                      onClick={() => onSettings(preset.value, room.song_total)}
                    >
                      {preset.label}
                    </button>
                  ))}
                  {room.topic && !TOPIC_PRESETS.some((preset) => preset.value === room.topic) && (
                    <button className="active" disabled>{topicLabel(room.topic)}</button>
                  )}
                </div>
                {isHost && (
                  <form
                    className="sqCustom"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (customTopic.trim()) onSettings(customTopic.trim(), room.song_total);
                      setCustomTopic("");
                    }}
                  >
                    <input value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} maxLength={20} placeholder="가수 이름 · 2015 · 2010~2015" />
                    <button className="smallButton" disabled={busy || !customTopic.trim()}>정하기</button>
                  </form>
                )}
                <strong>곡 수</strong>
                <div className="sqChips">
                  {SONG_COUNTS.map((count) => (
                    <button key={count} className={room.song_total === count ? "active" : ""} disabled={!isHost || busy} onClick={() => onSettings(room.topic, count)}>
                      {count}곡
                    </button>
                  ))}
                </div>
                <p className="sqRule">
                  곡마다 2초 → 4초 → 6초 듣기 → 가수 힌트 → 제목 힌트 순서로 열려요. 빨리 맞힐수록 점수가 커요
                  ({STAGES.map((_, i) => stagePoints(i)).join(" · ")}점).
                  <br />
                  {room.is_test ? "🧪 테스트 방: 티켓 · 점수 없음" : `시작하면 방장 티켓 ${cost}장 (운영진 무료 · 평일 9시 전 / 12~14시 / 18시 이후, 주말 종일)`}
                </p>
                {!isHost && <p className="sqRule muted">방장이 주제와 곡 수를 정하고 시작해요.</p>}
              </div>
            )}
            {room.status === "escrow" && (
              <div className="sqCenter">
                <span className="cmOverlayIcon">🎫</span>
                <strong>티켓 확인 중…</strong>
                <span>봇이 확인하면 바로 시작해요.</span>
              </div>
            )}
            {room.status === "playing" && room.phase === "intro" && (
              <div className="sqCenter">
                <span className="cmOverlayIcon">🎧</span>
                <strong>곧 시작해요!</strong>
                <span>{topicLabel(room.topic)} · {room.song_total}곡 · 소리를 켜 주세요</span>
              </div>
            )}
            {listening && (
              <div className="sqCenter">
                <button
                  className={`sqPlay ${playingClip ? "on" : ""}`}
                  disabled={loadingAudio}
                  onClick={() => void playClip(stage.clip)}
                  aria-label={`${stage.clip}초 다시 듣기`}
                >
                  {loadingAudio ? "…" : playingClip ? <span className="sqBars"><i /><i /><i /><i /></span> : "▶"}
                </button>
                <strong>{blocked ? "🔊 눌러서 들어 주세요" : `${stage.clip}초 듣기`}</strong>
                <ol className="sqSteps">
                  {STAGES.map((item, index) => (
                    <li key={index} className={index < room.stage ? "done" : index === room.stage ? "now" : ""}>
                      <span>{item.hint === "artist" ? "가수" : item.hint === "title" ? "제목" : `${item.clip}초`}</span>
                      <em>{stagePoints(index)}</em>
                    </li>
                  ))}
                </ol>
                {(room.hint_artist || room.hint_title) && (
                  <div className="sqHints">
                    {room.hint_artist && <span>🎤 가수 <b>{room.hint_artist}</b></span>}
                    {room.hint_title && <span>🏷️ 제목 <b>{room.hint_title}</b></span>}
                  </div>
                )}
                {audioError && <span className="sqError">{audioError}</span>}
              </div>
            )}
            {revealing && (
              <div className="sqCenter sqReveal">
                {room.reveal_art ? <img src={room.reveal_art} alt="" className="sqArt" /> : <span className="cmOverlayIcon">💿</span>}
                <strong>{room.last_winner ? `🎉 ${room.last_winner}님 정답! +${room.last_points ?? 0}점` : "⏰ 아무도 못 맞혔어요"}</strong>
                <span className="sqAnswer">「{room.reveal_title}」 {room.reveal_artist}</span>
                {blocked && <button className="smallButton" onClick={() => void playClip(REVEAL_SECONDS - 1)}>🔊 들어 보기</button>}
              </div>
            )}
            {room.status === "finished" && (
              <div className="sqCenter">
                <strong>🏁 최종 순위</strong>
                <ol className="cmRanking">
                  {ranking.map((player, index) => (
                    <li key={player.id}>
                      <span>{["🥇", "🥈", "🥉"][index] ?? `${index + 1}`}</span>
                      <b>{player.name}</b>
                      <em>{room.scores[player.id] ?? 0}점</em>
                    </li>
                  ))}
                </ol>
                {!room.is_test && <small className="muted">맞힌 점수는 카톡 점수판에 들어가요.</small>}
                {joined && (
                  <div className="cmResultActions">
                    <button className="smallButton ghost" onClick={onBack}>게임 종료</button>
                    <button className="primaryButton" disabled={busy} onClick={onRestart}>🔁 다시하기</button>
                  </div>
                )}
              </div>
            )}
            {room.status === "cancelled" && (
              <div className="sqCenter">
                <strong>닫힌 방이에요</strong>
              </div>
            )}
          </div>
        </div>

        <aside className="cmSide">
          <ul className="cmPlayers">
            {room.players.map((player) => (
              <li key={player.id} className={player.id === me ? "me" : ""}>
                <span className="cmAvatar">{player.name.slice(0, 1)}</span>
                <span className="cmName">
                  {player.name}
                  {player.id === room.host_member && <em>방장</em>}
                </span>
                <b>{room.scores[player.id] ?? 0}</b>
              </li>
            ))}
            {Array.from({ length: Math.max(0, Math.min(seatsLeft, 3)) }, (_, i) => (
              <li key={`empty${i}`} className="empty">
                <span className="cmAvatar" />
                <span className="cmName">빈 자리</span>
              </li>
            ))}
          </ul>

          <div className="cmChat">
            <div className="catchChatLog" ref={chatLogRef}>
              {chat.length === 0 && <span className="muted">곡 제목은 여기에 입력하세요.</span>}
              {chat.map((line) => (
                <div key={line.key} className={`catchChatLine ${line.kind ?? ""}`}>
                  {line.name && <b>{line.name}</b>} {line.text}
                </div>
              ))}
            </div>
            {joined && (
              <form
                className="catchChatInput"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onFocus={() => {
                    window.clearTimeout(blurTimer.current);
                    setTyping(true);
                  }}
                  onBlur={() => {
                    window.clearTimeout(blurTimer.current);
                    blurTimer.current = window.setTimeout(() => setTyping(false), 200);
                  }}
                  enterKeyHint="send"
                  autoComplete="off"
                  placeholder={listening ? "곡 제목 입력" : "채팅"}
                  maxLength={60}
                  aria-label="정답 · 채팅 입력"
                />
                <button type="submit" aria-label="보내기" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}>
                  ↑
                </button>
              </form>
            )}
          </div>
        </aside>
      </div>

      <div className="cmActions">
        <button className="smallButton ghost" onClick={onBack}>← 방 목록</button>
        <div className="cmActionsMain">
          {!joined && ["waiting", "escrow", "playing"].includes(room.status) && (
            <button className="primaryButton" disabled={busy || seatsLeft <= 0} onClick={onJoin}>
              {seatsLeft <= 0 ? "방이 가득 찼어요" : room.play_no > 0 ? "🔁 다시하기 참가" : "참가하기"}
            </button>
          )}
          {canRecruit && (
            <button className="smallButton cmRecruit" disabled={busy} onClick={onRecruit}>
              📣 카톡방에 모집
            </button>
          )}
          {room.status === "waiting" && (
            <button className="smallButton ghost" onClick={onCopyLink}>
              🔗 링크 복사
            </button>
          )}
          {joined && isHost && room.status === "waiting" && (
            <button className="primaryButton" disabled={busy} onClick={onStart}>
              ▶ 시작 ({room.song_total}곡{room.is_test ? "" : ` · 🎫${cost}`})
            </button>
          )}
          {joined && isHost && room.status === "playing" && (
            <button className="smallButton ghost" disabled={busy} onClick={onEnd}>■ 끝내기</button>
          )}
          {joined && ["waiting", "playing"].includes(room.status) && (
            <button className="smallButton ghost danger" disabled={busy} onClick={onLeave}>나가기</button>
          )}
        </div>
      </div>
    </div>
  );
}
