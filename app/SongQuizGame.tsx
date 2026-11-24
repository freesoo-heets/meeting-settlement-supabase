"use client";

import { copyInviteLink } from "./copyInvite";
import { useGameViewport } from "./useGameViewport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  CLIP_OFFSET,
  MODES,
  REVEAL_SECONDS,
  STAGES,
  TICKETS_PER_SONG,
  TOPIC_PRESETS,
  stagePoints,
  topicLabel,
  type SongMode,
} from "../lib/songQuiz";

// 🎧 노래 맞추기 — 늘 열려 있는 방 하나. 아무나 들어와 주제 · 전주/하이라이트를 골라 바로 출제 (한 번에 1곡)

type Room = {
  id: string;
  status: "waiting" | "escrow" | "playing" | "finished" | "cancelled";
  mode: SongMode;
  topic: string;
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
  escrow_state: string;
  reject_reason: string | null;
  notice: string | null;
  opener_member: string | null;
  opener_name: string | null;
  cost: number;
  play_no: number;
  updated_at: string;
};

type ChatLine = { key: number; name: string; text: string; kind?: "system" | "wrong" };
type Award = { member_id: string; name: string; points: number };

type Props = {
  onClose: () => void;
  onBack?: () => void;
  currentMemberId: string | null;
  myName: string;
  myTickets?: number | null;
  isAdmin?: boolean;
};

const COLUMNS =
  "id,status,mode,topic,stage,phase,phase_deadline,hint_artist,hint_title,reveal_title,reveal_artist,reveal_art,last_winner,last_points,escrow_state,reject_reason,notice,opener_member,opener_name,cost,play_no,updated_at";

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
  };
}

// 오늘 0시 (한국 시간)
function todayStartIso() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600 * 1000).toISOString();
}

export default function SongQuizGame({ onClose, onBack, currentMemberId, myName, myTickets, isAdmin }: Props) {
  useGameViewport();
  const [roomId, setRoomId] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [mode, setMode] = useState<SongMode>("highlight");
  const [now, setNow] = useState(Date.now());
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [present, setPresent] = useState<Array<{ id: string; name: string }>>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTick = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [typing, setTyping] = useState(false);
  const blurTimer = useRef(0);

  useEffect(() => {
    void callSong({ action: "lobby" }).then((result) => {
      if (result.ok && result.id) setRoomId(result.id);
      else setMessage(result.error ?? "노래 맞추기 방을 열지 못했어요.");
    });
  }, []);

  const load = useCallback(async () => {
    if (!roomId) return;
    const { data } = await supabase.from("song_rooms").select(COLUMNS).eq("id", roomId).maybeSingle();
    if (data) setRoom(data as Room);
  }, [roomId]);

  const loadAwards = useCallback(async () => {
    const { data } = await supabase.from("song_awards").select("member_id,name,points").gte("created_at", todayStartIso()).limit(1000);
    setAwards((data ?? []) as Award[]);
  }, []);

  useEffect(() => {
    void load();
    void loadAwards();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load, loadAwards]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const addChat = useCallback((line: Omit<ChatLine, "key">) => {
    setChat((current) => [...current.slice(-60), { ...line, key: Date.now() + Math.random() }]);
  }, []);

  // ── 실시간 채널 (채팅 · 접속한 사람) ──
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`song-${roomId}`, { config: { broadcast: { self: false }, presence: { key: currentMemberId ?? `watcher-${Math.random()}` } } })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Array<{ name?: string }>>;
        setPresent(
          Object.entries(state)
            .filter(([id]) => !id.startsWith("watcher"))
            .map(([id, metas]) => ({ id, name: String(metas[0]?.name ?? "?") })),
        );
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const data = payload as { name?: string; text?: string; wrong?: boolean };
        if (!data.text) return;
        addChat({ name: String(data.name ?? "").slice(0, 10), text: String(data.text).slice(0, 60), kind: data.wrong ? "wrong" : undefined });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "song_rooms", filter: `id=eq.${roomId}` }, () => void load())
      .subscribe((state) => {
        if (state === "SUBSCRIBED" && currentMemberId) void channel.track({ name: myName, at: Date.now() });
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId, currentMemberId, myName, addChat, load]);

  // ── 소리 ──
  //  음원은 서버에서 받아 곡마다 한 번만 받아 둔다. 휴대폰은 처음 한 번은 손으로 눌러야 소리가 난다.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobs = useRef<Record<string, string>>({});
  const stopTimer = useRef(0);
  const [blocked, setBlocked] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playingClip, setPlayingClip] = useState(false);
  const [audioError, setAudioError] = useState("");
  const playNo = room?.play_no ?? 0;

  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
    const saved = blobs.current;
    return () => {
      audioRef.current?.pause();
      window.clearTimeout(stopTimer.current);
      Object.values(saved).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const ensureAudio = useCallback(
    async (kind: "clip" | "full") => {
      const key = `${playNo}:${kind}`;
      if (blobs.current[key]) return blobs.current[key];
      setLoadingAudio(true);
      try {
        const response = await fetch("/api/song", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
          body: JSON.stringify({ action: "audio", playNo, kind }),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(result.error ?? `음원 오류 ${response.status}`);
        }
        const url = URL.createObjectURL(await response.blob());
        // 지난 곡 음원은 정리
        for (const [k, old] of Object.entries(blobs.current)) {
          if (!k.startsWith(`${playNo}:`)) {
            URL.revokeObjectURL(old);
            delete blobs.current[k];
          }
        }
        blobs.current[key] = url;
        setAudioError("");
        return url;
      } finally {
        setLoadingAudio(false);
      }
    },
    [playNo],
  );

  // 🔊 소리 크기 (기기마다 기억). 아이폰은 audio.volume 을 무시해서, 막대를 움직이면 Web Audio 로 줄인다
  const [volume, setVolume] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem("songQuizVolume"));
      return Number.isFinite(saved) && saved > 0 && saved <= 1 ? saved : 0.8;
    } catch {
      return 0.8;
    }
  });
  const [muted, setMuted] = useState(false);
  const gainRef = useRef<GainNode | null>(null);
  const applyVolume = useCallback((value: number, fromGesture: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = value;
    if (!gainRef.current && fromGesture && Math.abs(audio.volume - value) > 0.01) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const gain = ctx.createGain();
        ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
        void ctx.resume();
        gainRef.current = gain;
      } catch {
        // 못 쓰면 기기 음량으로
      }
    }
    if (gainRef.current) {
      void (gainRef.current.context as AudioContext).resume?.();
      gainRef.current.gain.value = value;
    }
  }, []);
  useEffect(() => {
    applyVolume(muted ? 0 : volume, false);
  }, [volume, muted, applyVolume]);
  const changeVolume = (value: number) => {
    setVolume(value);
    setMuted(false);
    applyVolume(value, true);
    try {
      window.localStorage.setItem("songQuizVolume", String(value));
    } catch {
      // 저장 못 해도 이번에는 적용
    }
  };

  const stopClip = useCallback(() => {
    window.clearTimeout(stopTimer.current);
    audioRef.current?.pause();
    setPlayingClip(false);
  }, []);

  const play = useCallback(
    async (kind: "clip" | "full", seconds: number, offset: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        const url = await ensureAudio(kind);
        stopClip();
        if (audio.src !== url) audio.src = url;
        audio.currentTime = offset;
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

  const listening = room?.status === "playing" && room.phase === "listen";
  const revealing = room?.status === "playing" && room.phase === "reveal";
  const stage = STAGES[Math.min(room?.stage ?? 0, STAGES.length - 1)];
  // 전주 조각은 첫 소리부터 잘라 두었고, 미리듣기는 앞쪽 페이드인을 건너뛴다
  const clipOffset = room?.mode === "intro" ? 0 : CLIP_OFFSET;
  const playClip = useCallback(() => play("clip", stage.clip, clipOffset), [play, stage.clip, clipOffset]);
  const playFull = useCallback(() => play("full", REVEAL_SECONDS - 1, CLIP_OFFSET), [play]);

  // 단계가 바뀌면 그 길이만큼 자동으로 들려준다 · 정답 공개 때는 하이라이트를 길게
  const autoKey = `${playNo}:${room?.phase}:${room?.stage}`;
  const lastAuto = useRef("");
  useEffect(() => {
    if (!room || lastAuto.current === autoKey) return;
    const first = lastAuto.current === "";
    lastAuto.current = autoKey;
    if (listening) void playClip();
    else if (revealing && !first) void playFull();
    else stopClip();
  }, [autoKey, room, listening, revealing, playClip, playFull, stopClip]);

  // '곧 시작' 동안 문제 음원을 미리 받아 둔다
  useEffect(() => {
    if (room?.status === "playing" && room.phase === "intro") void ensureAudio("clip").catch(() => undefined);
  }, [room?.status, room?.phase, ensureAudio]);

  // 진행 알림을 채팅에 남긴다
  const lastPhaseKey = useRef("");
  useEffect(() => {
    if (!room) return;
    const key = `${room.play_no}:${room.status}:${room.phase}:${room.stage}`;
    if (lastPhaseKey.current === key) return;
    const first = lastPhaseKey.current === "";
    lastPhaseKey.current = key;
    if (first) return;
    if (room.status === "playing" && room.phase === "reveal") {
      addChat({
        name: "",
        kind: "system",
        text: room.last_winner
          ? `🎉 ${room.last_winner}님 정답! +${room.last_points ?? 0}점 · 「${room.reveal_title}」 ${room.reveal_artist}`
          : `⏰ 정답은 「${room.reveal_title}」 ${room.reveal_artist}`,
      });
      void loadAwards();
    } else if (room.status === "playing" && room.phase === "intro") {
      addChat({ name: "", kind: "system", text: `🎵 ${room.opener_name}님 출제 · ${topicLabel(room.topic)} · ${room.mode === "intro" ? "🎹 전주" : "🎤 하이라이트"}` });
    } else if (room.status === "playing" && room.phase === "listen" && room.stage > 0) {
      addChat({ name: "", kind: "system", text: `${STAGES[room.stage].label} · 배점 ${stagePoints(room.stage)}점` });
    }
  }, [room, addChat, loadAwards]);

  // 시간이 지나면 서버에 다음 단계로 넘겨 달라고 한다 (출제가 멈춘 것도)
  useEffect(() => {
    if (!room) return;
    const stuck = room.status === "escrow" && now - new Date(room.updated_at).getTime() > 95_000;
    const over = room.status === "playing" && room.phase_deadline ? now - new Date(room.phase_deadline).getTime() : -1;
    if ((over > 1800 || stuck) && now - lastTick.current > 2500) {
      lastTick.current = now;
      void callSong({ action: "tick" }).then(() => load());
    }
  }, [now, room, load]);

  // 다른 사람 화면에서 고른 주제가 아니라, 내 화면에서 고른 주제로 출제한다
  async function ask() {
    setBusy(true);
    setMessage("");
    setInfo("");
    const result = await callSong({ action: "ask", topic: customTopic.trim() || topic, mode });
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "출제하지 못했어요.");
    else setCustomTopic("");
    await load();
  }

  async function submit() {
    const value = text.trim();
    if (!value || !currentMemberId) return;
    setText("");
    inputRef.current?.focus();
    if (listening) {
      const result = await callSong({ action: "guess", text: value });
      if (result.ok && result.correct) {
        void load();
        return;
      }
      addChat({ name: myName, text: value, kind: "wrong" });
      void channelRef.current?.send({ type: "broadcast", event: "chat", payload: { name: myName, text: value, wrong: true } });
      return;
    }
    addChat({ name: myName, text: value });
    void channelRef.current?.send({ type: "broadcast", event: "chat", payload: { name: myName, text: value } });
  }

  const ranking = useMemo(() => {
    const total = new Map<string, { name: string; points: number; wins: number }>();
    for (const a of awards) {
      const row = total.get(a.member_id) ?? { name: a.name, points: 0, wins: 0 };
      row.points += a.points;
      row.wins += 1;
      total.set(a.member_id, row);
    }
    return [...total.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.points - a.points);
  }, [awards]);

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

  const remaining = room?.phase_deadline ? Math.max(0, Math.ceil((new Date(room.phase_deadline).getTime() - now) / 1000)) : 0;
  const total = room?.phase === "listen" ? stage.seconds : room?.phase === "reveal" ? REVEAL_SECONDS : 4;
  const idle = room?.status === "waiting";
  const canSkip = room?.status === "playing" && (room.phase === "listen" || room.phase === "intro") && (room.opener_member === currentMemberId || isAdmin);
  // 출제 실패 안내는 2분 동안만 (다음 사람에게까지 남지 않게)
  const fresh = room ? now - new Date(room.updated_at).getTime() < 120_000 : false;
  const notice = idle ? (fresh ? room?.reject_reason || room?.notice : null) : room?.notice;
  const statusLabel = !room ? "…" : idle ? "출제 대기" : room.status === "escrow" ? "준비 중" : room.phase === "reveal" ? "정답 공개" : "문제 중";

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
            <span>
              누구나 출제 · 1곡에 티켓 {TICKETS_PER_SONG}장 · 정답 최대 {stagePoints(0)}점
              {myTickets !== null && myTickets !== undefined ? ` · 내 티켓 🎫 ${myTickets}` : ""}
            </span>
            <h2>🎧 노래 맞추기</h2>
          </div>
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        {message && <div className="omokMessage">{message}</div>}
        {info && !message && <div className="omokMessage info">{info}</div>}

        <div className={`cmRoom sqRoom ${typing ? "typing" : ""}`}>
          <div className="cmTop">
            <span className={`cmPill ${idle ? "waiting" : ""}`}>{statusLabel}</span>
            <div className="cmWord">
              {listening && room ? (
                <>
                  <small>{room.mode === "intro" ? "🎹 전주" : "🎤 하이라이트"} · {stage.label} · 배점 {stagePoints(room.stage)}점</small>
                  <strong>{room.hint_title ?? (room.hint_artist ? `가수 ${room.hint_artist}` : "곡 제목은?")}</strong>
                </>
              ) : revealing && room ? (
                <>
                  <small>정답</small>
                  <strong>{room.reveal_title}</strong>
                </>
              ) : room && !idle ? (
                <>
                  <small>{room.opener_name}님 출제</small>
                  <strong>{topicLabel(room.topic)}</strong>
                </>
              ) : (
                <>
                  <small>지금 {present.length}명 접속</small>
                  <strong>누구나 출제!</strong>
                </>
              )}
            </div>
            <span className={`cmTime ${remaining <= 5 && listening ? "urgent" : ""}`}>{room?.status === "playing" ? `${remaining}″` : ""}</span>
          </div>
          {room?.status === "playing" && (
            <div className="cmTimer">
              <div style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }} className={remaining <= 5 && listening ? "urgent" : ""} />
            </div>
          )}

          <div className="cmMain">
            <div className="cmStage">
              <div className={`sqStage ${idle ? "waiting" : room?.phase ?? room?.status ?? ""}`}>
                {!room && <div className="sqCenter"><strong>방을 여는 중…</strong></div>}
                {room && idle && (
                  <div className="sqSetup">
                    {notice && <div className="sqReject">{notice.startsWith("⚠️") ? notice : `⚠️ ${notice}`}</div>}
                    <strong>주제</strong>
                    <div className="sqChips">
                      {TOPIC_PRESETS.map((preset) => (
                        <button
                          key={preset.value || "kpop"}
                          className={!customTopic.trim() && topic === preset.value ? "active" : ""}
                          onClick={() => {
                            setTopic(preset.value);
                            setCustomTopic("");
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <input
                      className="sqCustomInput"
                      value={customTopic}
                      onChange={(event) => setCustomTopic(event.target.value)}
                      maxLength={20}
                      placeholder="직접 입력: 가수 이름 · 2015 · 2010~2015"
                    />
                    <strong>어디를 들려줄까요?</strong>
                    <div className="sqChips">
                      {MODES.map((item) => (
                        <button key={item.value} className={mode === item.value ? "active" : ""} onClick={() => setMode(item.value)}>
                          {item.label} <small>{item.desc}</small>
                        </button>
                      ))}
                    </div>
                    <button className="primaryButton sqAsk" disabled={busy || !currentMemberId} onClick={() => void ask()}>
                      {busy ? "곡 고르는 중…" : `🎵 출제하기 (🎫 ${TICKETS_PER_SONG}장)`}
                    </button>
                    <p className="sqRule">
                      2초 → 4초 → 6초 듣기 → 가수 힌트 → 제목 힌트 순서로 열려요. 빨리 맞힐수록 점수가 커요 ({STAGES.map((_, i) => stagePoints(i)).join(" · ")}점).
                      출제한 사람도 맞힐 수 있어요.
                    </p>
                  </div>
                )}
                {room?.status === "escrow" && (
                  <div className="sqCenter">
                    <span className="cmOverlayIcon">{room.mode === "intro" && room.escrow_state === "locked" ? "🎹" : "🎫"}</span>
                    <strong>
                      {room.escrow_state === "none"
                        ? "곡 고르는 중…"
                        : room.mode === "intro" && room.escrow_state === "locked"
                          ? "전주 준비 중…"
                          : "티켓 확인 중…"}
                    </strong>
                    <span>{room.opener_name}님 출제 · {topicLabel(room.topic)}</span>
                  </div>
                )}
                {room?.status === "playing" && room.phase === "intro" && (
                  <div className="sqCenter">
                    <span className="cmOverlayIcon">🎧</span>
                    <strong>곧 시작해요!</strong>
                    <span>{room.opener_name}님 출제 · {topicLabel(room.topic)} · {room.mode === "intro" ? "🎹 전주" : "🎤 하이라이트"}</span>
                    {room.notice && <span>{room.notice}</span>}
                  </div>
                )}
                {listening && room && (
                  <div className="sqCenter">
                    <button className={`sqPlay ${playingClip ? "on" : ""}`} disabled={loadingAudio} onClick={() => void playClip()} aria-label={`${stage.clip}초 다시 듣기`}>
                      {loadingAudio ? "…" : playingClip ? <span className="sqBars"><i /><i /><i /><i /></span> : "▶"}
                    </button>
                    <strong>{blocked ? "🔊 눌러서 들어 주세요" : `${room.mode === "intro" ? "전주" : "하이라이트"} ${stage.clip}초`}</strong>
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
                {revealing && room && (
                  <div className="sqCenter sqReveal">
                    {room.reveal_art ? <img src={room.reveal_art} alt="" className="sqArt" /> : <span className="cmOverlayIcon">💿</span>}
                    <strong>{room.last_winner ? `🎉 ${room.last_winner}님 정답! +${room.last_points ?? 0}점` : "⏰ 정답 공개"}</strong>
                    <span className="sqAnswer">「{room.reveal_title}」 {room.reveal_artist}</span>
                    <button className="smallButton" onClick={() => void playFull()}>🔊 하이라이트 듣기</button>
                  </div>
                )}
              </div>
            </div>

            <aside className="cmSide">
              <div className="sqVolume">
                <button
                  className="smallButton ghost"
                  aria-label={muted ? "소리 켜기" : "소리 끄기"}
                  onClick={() => {
                    setMuted((m) => !m);
                    applyVolume(muted ? volume : 0, true);
                  }}
                >
                  {muted || volume === 0 ? "🔇" : volume < 0.4 ? "🔈" : volume < 0.75 ? "🔉" : "🔊"}
                </button>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(event) => changeVolume(Number(event.target.value))}
                  aria-label="소리 크기"
                />
                <span>{muted ? 0 : Math.round(volume * 100)}%</span>
              </div>
              <div className="sqBoard">
                <strong>🏆 오늘의 순위</strong>
                {ranking.length === 0 ? (
                  <span className="muted">아직 맞힌 사람이 없어요.</span>
                ) : (
                  <ol>
                    {ranking.slice(0, 5).map((row, index) => (
                      <li key={row.id} className={row.id === currentMemberId ? "me" : ""}>
                        <span>{["🥇", "🥈", "🥉"][index] ?? `${index + 1}`}</span>
                        <b>{row.name}</b>
                        <em>{row.points}점 · {row.wins}곡</em>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="sqPresent">
                👥 {present.length}명 · {present.slice(0, 12).map((p) => p.name).join(", ")}
                {present.length > 12 ? ` 외 ${present.length - 12}명` : ""}
              </div>

              <div className="cmChat">
                <div className="catchChatLog" ref={chatLogRef}>
                  {chat.length === 0 && <span className="muted">곡 제목은 여기에 입력하세요.</span>}
                  {chat.map((line) => (
                    <div key={line.key} className={`catchChatLine ${line.kind ?? ""}`}>
                      {line.name && <b>{line.name}</b>} {line.text}
                    </div>
                  ))}
                </div>
                {currentMemberId && (
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
            {onBack ? <button className="smallButton ghost" onClick={onBack}>← 게임</button> : <span />}
            <div className="cmActionsMain">
              {canSkip && (
                <button
                  className="smallButton ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("정답을 공개하고 넘길까요? (티켓은 돌려드리지 않아요)")) return;
                    void callSong({ action: "skip" }).then((result) => {
                      if (!result.ok) setMessage(result.error ?? "실패했어요.");
                      void load();
                    });
                  }}
                >
                  ⏭ 정답 공개
                </button>
              )}
              {room && (
                <button
                  className="smallButton cmRecruit"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("카톡방에 같이 하자는 알림을 보낼까요?")) return;
                    void callSong({ action: "recruit" }).then((result) => {
                      if (!result.ok) setMessage(result.error ?? "실패했어요.");
                      else setInfo("📣 카톡방에 알림을 보냈어요. (봇이 몇 초 안에 올립니다)");
                    });
                  }}
                >
                  📣 카톡방에 모집
                </button>
              )}
              {room && (
                <button className="smallButton ghost" onClick={() => void copyInviteLink("song", "start").then(setInfo)}>
                  🔗 링크 복사
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
