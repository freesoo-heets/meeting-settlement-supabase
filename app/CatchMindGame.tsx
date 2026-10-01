"use client";

import { useGameViewport } from "./useGameViewport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import CatchGallery from "./CatchGallery";

// 캐치마인드 (최대 6명 · 점수 내기 없음)

type Member = { id: string; name: string };

type Room = {
  id: string;
  status: "waiting" | "playing" | "finished" | "cancelled";
  host_member: string;
  host_name: string;
  players: Member[];
  max_players: number;
  rounds: number;
  turn_no: number;
  turn_total: number;
  drawer_member: string | null;
  drawer_name: string | null;
  phase: "drawing" | "reveal" | null;
  phase_deadline: string | null;
  hint: string | null;
  reveal_word: string | null;
  last_winner: string | null;
  scores: Record<string, number>;
  is_test?: boolean;
  recruit_no?: number;
  play_no?: number;
  created_at: string;
  updated_at: string;
};

type Stroke = { sid: string; color: string; size: number; pts: Array<[number, number]> };
type ChatLine = { key: number; name: string; text: string; kind?: "system" | "close" };

type Props = {
  onClose: () => void;
  onBack?: () => void;
  initialRoomId?: string;
  currentMemberId: string | null;
  myName: string;
  isAdmin?: boolean;
};

const COLUMNS =
  "id,status,host_member,host_name,players,max_players,rounds,turn_no,turn_total,drawer_member,drawer_name,phase,phase_deadline,hint,reveal_word,last_winner,scores,is_test,play_no,created_at,updated_at";
const DRAW_SECONDS = 80;
const CANVAS_W = 800;
const CANVAS_H = 560;
const COLORS = ["#111111", "#e11d48", "#f97316", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#8b5a2b", "#ffffff"];
const SIZES = [4, 10, 22];
const DRAWER_WARN_MS = 10_000; // 출제자가 이만큼 그리지 않으면 경고
const DRAWER_KICK_MS = 20_000; // 이만큼 그리지 않으면 자동으로 나간다
const ABSENT_KICK_MS = 10_000; // 창을 닫거나 연결이 끊긴 뒤 이만큼 지나면 자동으로 내보낸다

async function callCatch(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/catch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as {
    ok: boolean;
    error?: string;
    id?: string;
    word?: string;
    correct?: boolean;
  };
}

export default function CatchMindGame({ onClose, onBack, initialRoomId, currentMemberId, myName, isAdmin }: Props) {
  useGameViewport(); // 휴대폰: 뒤 페이지 스크롤 막기 · 키보드 높이에 맞추기
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState(initialRoomId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("catch_rooms")
      .select(COLUMNS)
      .or(`status.in.(waiting,playing),updated_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return;
    const rows = (data ?? []) as Room[];
    if (initialRoomId && !rows.some((row) => row.id === initialRoomId)) {
      const single = await supabase.from("catch_rooms").select(COLUMNS).eq("id", initialRoomId).maybeSingle();
      if (single.data) rows.push(single.data as Room);
    }
    setRooms(rows);
  }, [initialRoomId]);

  // 목록을 열 때 유령 방 정리 (한 번)
  useEffect(() => {
    void callCatch({ action: "cleanup" }).then(() => load());
  }, [load]);

  const myRoom = useMemo(
    () =>
      rooms.find(
        (room) =>
          (room.status === "waiting" || room.status === "playing") &&
          room.players.some((player) => player.id === currentMemberId),
      ) ?? null,
    [rooms, currentMemberId],
  );

  useEffect(() => {
    if (myRoom) setRoomId((current) => current || myRoom.id);
  }, [myRoom]);

  const room = rooms.find((item) => item.id === roomId) ?? null;
  const playing = room?.status === "playing";

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), playing ? 2000 : 3000);
    return () => window.clearInterval(timer);
  }, [load, playing]);

  async function run(payload: Record<string, unknown>, after?: (id?: string) => void) {
    setBusy(true);
    setMessage("");
    setInfo("");
    const result = await callCatch(payload);
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "실패했습니다.");
    else after?.(result.id);
    await load();
  }

  const openRooms = rooms.filter(
    (item) =>
      (item.status === "waiting" || item.status === "playing") &&
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
            <span>최대 6명 · 한 사람당 2번 출제 · {DRAW_SECONDS}초</span>
            <h2>🎨 캐치마인드</h2>
          </div>
          <div className="gameHeaderActions">
            {onBack && <button className="smallButton ghost" onClick={onBack}>← 게임</button>}
            <button className="modalCloseButton" onClick={onClose}>×</button>
          </div>
        </div>

        {message && <div className="omokMessage">{message}</div>}
        {info && !message && <div className="omokMessage info">{info}</div>}

        {room ? (
          <CatchRoomView
            room={room}
            me={currentMemberId}
            myName={myName}
            busy={busy}
            onReload={load}
            onBack={() => setRoomId("")}
            onJoin={() => run({ action: "join", roomId: room.id })}
            onLeave={() => run({ action: "leave", roomId: room.id }, () => setRoomId(""))}
            onStart={() => run({ action: "start", roomId: room.id })}
            onRestart={() => run({ action: "restart", roomId: room.id })}
            onRecruit={() => {
              if (!window.confirm("카톡방에 참가자 모집 알림을 보낼까요?")) return;
              void run({ action: "recruit", roomId: room.id }, () =>
                setInfo("📣 카톡방에 모집 알림을 보냈어요. (봇이 몇 초 안에 올립니다)"),
              );
            }}
          />
        ) : (
          <div className="omokLobby">
            {!myRoom && (
              <div className="omokCreate">
                <strong>새 방</strong>
                <button className="primaryButton" disabled={busy} onClick={() => run({ action: "create" }, (id) => id && setRoomId(id))}>
                  캐치마인드 방 만들기
                </button>
                <small>2~6명이 모이면 방장이 시작합니다. 점수는 걸지 않습니다.</small>
                {isAdmin && (
                  <button
                    className="smallButton ghost omokTestButton"
                    disabled={busy}
                    onClick={() => run({ action: "create_test" }, (id) => id && setRoomId(id))}
                  >
                    🧪 테스트 방 (관리자 · 혼자 시작 · 출제자도 정답 입력 가능)
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
                    <strong>{item.host_name}님의 방</strong>
                    <span>
                      {item.status === "waiting" ? "대기 중" : `진행 중 ${Math.min(item.turn_no + 1, item.turn_total)}/${item.turn_total}`} ·{" "}
                      {item.players.length}/{item.max_players}명 · {item.players.map((player) => player.name).join(", ")}
                    </span>
                  </div>
                  <button className="smallButton" onClick={() => setRoomId(item.id)}>
                    {item.id === myRoom?.id ? "돌아가기" : "들어가기"}
                  </button>
                </div>
              ))}
            </div>
            <CatchGallery />
          </div>
        )}
      </section>
    </div>
  );
}

function CatchRoomView({
  room,
  me,
  myName,
  busy,
  onReload,
  onBack,
  onJoin,
  onLeave,
  onStart,
  onRecruit,
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
  onRecruit: () => void;
  onRestart: () => void;
}) {
  const joined = room.players.some((player) => player.id === me);
  const isHost = room.host_member === me;
  const isDrawer = room.status === "playing" && room.phase === "drawing" && room.drawer_member === me;
  // 테스트 방: 혼자 시작 가능, 출제자도 정답을 입력해 흐름을 확인할 수 있다
  const minPlayers = room.is_test ? 1 : 2;
  const chatLocked = isDrawer && !room.is_test;
  const [now, setNow] = useState(Date.now());
  const [word, setWord] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const pendingRef = useRef<Array<[number, number]>>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTick = useRef(0);
  const presentRef = useRef<Set<string>>(new Set());
  const presenceReadyRef = useRef(false);
  const joinedRef = useRef(false);
  const absentSince = useRef<Record<string, number>>({});
  const kicking = useRef(false);
  // 출제자 무입력 감시 — 방을 제대로 안 나가고 방치된 경우를 대비한다
  //   · 출제 차례가 '시작된 시각'부터 센다 (예전엔 이전 시각이 남아 차례가 오자마자 튕겼다)
  //   · 그 차례에 한 번이라도 입력(그리기·색·굵기·지우기)하면 시간 제한을 없앤다
  const turnKey = `${room.turn_no}:${room.drawer_member ?? ""}`;
  const drawerTurn = useRef<{ key: string; startedAt: number; touched: boolean; kicked: boolean }>({
    key: "",
    startedAt: 0,
    touched: false,
    kicked: false,
  });
  // 다시하기로 새 판이 시작돼도 이전 판 기록과 섞이지 않게 판 번호까지 붙인다
  const drawerSlot = `${room.play_no ?? 0}:${turnKey}`;
  if (isDrawer && drawerTurn.current.key !== drawerSlot) {
    drawerTurn.current = { key: drawerSlot, startedAt: Date.now(), touched: false, kicked: false };
  }
  const touchInput = () => {
    drawerTurn.current.touched = true;
  };
  const turnKeyRef = useRef(turnKey);
  const isDrawerRef = useRef(isDrawer);
  const [typing, setTyping] = useState(false);
  isDrawerRef.current = isDrawer;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const addChat = useCallback((line: Omit<ChatLine, "key">) => {
    setChat((current) => [...current.slice(-60), { ...line, key: Date.now() + Math.random() }]);
  }, []);

  // ── 캔버스 ──
  const paintStroke = useCallback((stroke: Stroke, from = 0) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || stroke.pts.length === 0) return;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const pts = stroke.pts.map(([x, y]) => [x * CANVAS_W, y * CANVAS_H] as [number, number]);
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    const start = Math.max(0, from - 1);
    ctx.moveTo(pts[start][0], pts[start][1]);
    for (let i = start + 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }, []);

  const redraw = useCallback(() => {
    clearCanvas();
    strokesRef.current.forEach((stroke) => paintStroke(stroke));
  }, [clearCanvas, paintStroke]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // 턴이 바뀌면 그림을 지운다
  useEffect(() => {
    if (turnKeyRef.current !== turnKey) {
      turnKeyRef.current = turnKey;
      strokesRef.current = [];
      redraw();
      setWord("");
    }
  }, [turnKey, redraw]);

  // 출제자만 제시어를 받는다
  useEffect(() => {
    if (!isDrawer) return;
    void callCatch({ action: "word", roomId: room.id }).then((result) => {
      if (result.ok && result.word) setWord(result.word);
    });
  }, [isDrawer, room.id, turnKey]);

  // ── 실시간 채널 (그림 · 채팅) ──
  useEffect(() => {
    const channel = supabase
      .channel(`catch-${room.id}`, { config: { broadcast: { self: false }, presence: { key: me ?? "watcher" } } })
      // 접속 상태: 창을 닫거나 연결이 끊긴 사람을 알아내는 데 쓴다
      .on("presence", { event: "sync" }, () => {
        presentRef.current = new Set(Object.keys(channel.presenceState()));
        presenceReadyRef.current = true;
      })
      .on("broadcast", { event: "stroke" }, ({ payload }) => {
        const data = payload as { turn?: string; sid?: string; color?: string; size?: number; pts?: Array<[number, number]> };
        if (data.turn !== turnKeyRef.current || !data.sid || !Array.isArray(data.pts)) return;
        let stroke = strokesRef.current.find((item) => item.sid === data.sid);
        const from = stroke ? stroke.pts.length : 0;
        if (!stroke) {
          stroke = { sid: data.sid, color: String(data.color ?? "#111"), size: Number(data.size ?? 8), pts: [] };
          strokesRef.current.push(stroke);
        }
        stroke.pts.push(...data.pts.slice(0, 200));
        paintStroke(stroke, from);
      })
      .on("broadcast", { event: "clear" }, ({ payload }) => {
        if ((payload as { turn?: string }).turn !== turnKeyRef.current) return;
        strokesRef.current = [];
        redraw();
      })
      .on("broadcast", { event: "sync-req" }, () => {
        if (!isDrawerRef.current) return;
        void channel.send({
          type: "broadcast",
          event: "sync",
          payload: { turn: turnKeyRef.current, strokes: strokesRef.current },
        });
      })
      .on("broadcast", { event: "sync" }, ({ payload }) => {
        const data = payload as { turn?: string; strokes?: Stroke[] };
        if (data.turn !== turnKeyRef.current || !Array.isArray(data.strokes)) return;
        if (strokesRef.current.length > 0) return;
        strokesRef.current = data.strokes.slice(0, 500);
        redraw();
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const data = payload as { name?: string; text?: string };
        if (!data.text) return;
        addChat({ name: String(data.name ?? "").slice(0, 10), text: String(data.text).slice(0, 60) });
      })
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "catch_rooms", filter: `id=eq.${room.id}` },
        () => void onReload(),
      )
      .subscribe((state) => {
        if (state !== "SUBSCRIBED") return;
        void channel.send({ type: "broadcast", event: "sync-req", payload: {} });
        if (joinedRef.current && me) void channel.track({ at: Date.now() });
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [room.id, addChat, paintStroke, redraw, onReload]);

  // 테스트 방은 혼자 확인하는 곳이라 무입력으로 내보내지 않는다
  const watchIdle = isDrawer && !room.is_test && !drawerTurn.current.touched && drawerTurn.current.key === drawerSlot;
  const drawerIdle = watchIdle ? Math.max(0, now - drawerTurn.current.startedAt) : 0;
  useEffect(() => {
    if (!watchIdle || drawerTurn.current.kicked || drawerIdle < DRAWER_KICK_MS) return;
    // 내보내기 직전에 지금 시각으로 한 번 더 확인
    const turn = drawerTurn.current;
    if (turn.touched || turn.key !== drawerSlot || Date.now() - turn.startedAt < DRAWER_KICK_MS) return;
    turn.kicked = true;
    onLeave(); // 출제자가 나가면 이번 문제는 정답 공개 후 다음 사람 차례
  }, [watchIdle, drawerIdle, drawerSlot, onLeave]);

  // ★ 아이폰 등은 touch-action 만으로 스크롤이 안 막혀서, 그림판 위 손가락 움직임을 직접 막는다
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = (event: TouchEvent) => {
      if (isDrawerRef.current) event.preventDefault();
    };
    canvas.addEventListener("touchstart", stop, { passive: false });
    canvas.addEventListener("touchmove", stop, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", stop);
      canvas.removeEventListener("touchmove", stop);
    };
  }, []);

  // 참가하면 접속 표시를 시작한다 (관전만 할 때는 표시하지 않음)
  useEffect(() => {
    joinedRef.current = joined;
    if (joined && me) void channelRef.current?.track({ at: Date.now() });
    else void channelRef.current?.untrack();
  }, [joined, me]);

  // ★ 창을 닫거나 연결이 끊긴 지 10초가 지난 참가자는 자동으로 내보낸다
  //   남아 있는 사람 중 명단 맨 앞사람의 화면 한 곳에서만 서버에 요청한다
  useEffect(() => {
    if (room.status !== "waiting" && room.status !== "playing") return;
    const timer = window.setInterval(() => {
      if (!presenceReadyRef.current || !joinedRef.current || !me) return;
      const present = presentRef.current;
      const now = Date.now();
      const gone: string[] = [];
      for (const player of room.players) {
        if (player.id === me || present.has(player.id)) {
          delete absentSince.current[player.id];
          continue;
        }
        absentSince.current[player.id] ??= now;
        if (now - absentSince.current[player.id] >= ABSENT_KICK_MS) gone.push(player.id);
      }
      const leader = room.players.find((player) => player.id === me || present.has(player.id));
      if (gone.length === 0 || leader?.id !== me || kicking.current) return;
      kicking.current = true;
      void callCatch({ action: "remove_absent", roomId: room.id, ids: gone }).then(() => {
        gone.forEach((id) => delete absentSince.current[id]);
        kicking.current = false;
        void onReload();
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [room.status, room.players, room.id, me, onReload]);

  // 문제가 끝나면(정답 공개) 출제자 화면이 그림을 저장한다 → 최근 그림 갤러리
  const savedDrawing = useRef("");
  useEffect(() => {
    if (room.status !== "playing" && room.status !== "finished") return;
    if (room.phase !== "reveal" || room.drawer_member !== me || !room.reveal_word) return;
    const key = `${room.play_no ?? 0}:${room.turn_no}`;
    if (savedDrawing.current === key || strokesRef.current.length === 0) return;
    savedDrawing.current = key;
    void callCatch({
      action: "save_drawing",
      roomId: room.id,
      turnNo: room.turn_no,
      strokes: strokesRef.current.map(({ color, size, pts }) => ({ color, size, pts })),
    });
  }, [room.status, room.phase, room.drawer_member, room.reveal_word, room.turn_no, room.play_no, room.id, me]);

  // 정답·시간 초과 알림을 채팅에 남긴다
  const lastPhaseKey = useRef("");
  useEffect(() => {
    const key = `${room.turn_no}:${room.phase}`;
    if (lastPhaseKey.current === key) return;
    const first = lastPhaseKey.current === "";
    lastPhaseKey.current = key;
    if (first) return;
    if (room.phase === "reveal") {
      addChat({
        name: "",
        kind: "system",
        text: room.last_winner
          ? `🎉 ${room.last_winner}님 정답! 정답은 「${room.reveal_word ?? ""}」`
          : `⏰ 시간 종료! 정답은 「${room.reveal_word ?? ""}」`,
      });
    } else if (room.phase === "drawing") {
      addChat({ name: "", kind: "system", text: `✏️ ${room.drawer_name}님이 그립니다 (${room.turn_no + 1}/${room.turn_total})` });
    }
  }, [room.turn_no, room.phase, room.last_winner, room.reveal_word, room.drawer_name, room.turn_total, addChat]);

  // 시간이 지나면 서버에 다음 단계로 넘겨 달라고 한다
  useEffect(() => {
    if (room.status !== "playing" || !room.phase_deadline) return;
    const over = now - new Date(room.phase_deadline).getTime();
    if (over > 1800 && now - lastTick.current > 2500) {
      lastTick.current = now;
      void callCatch({ action: "tick", roomId: room.id }).then(() => onReload());
    }
  }, [now, room, onReload]);

  // ── 그리기 (출제자) ──
  function point(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
  }

  function flush() {
    const stroke = drawingRef.current;
    const pts = pendingRef.current;
    if (!stroke || pts.length === 0) return;
    pendingRef.current = [];
    void channelRef.current?.send({
      type: "broadcast",
      event: "stroke",
      payload: { turn: turnKeyRef.current, sid: stroke.sid, color: stroke.color, size: stroke.size, pts },
    });
  }

  useEffect(() => {
    if (!isDrawer) return;
    const timer = window.setInterval(flush, 60);
    return () => window.clearInterval(timer);
  }, [isDrawer]);

  const remaining = room.phase_deadline
    ? Math.max(0, Math.ceil((new Date(room.phase_deadline).getTime() - now) / 1000))
    : 0;

  async function submit() {
    const value = text.trim();
    if (!value || !joined) return;
    setText("");
    if (room.status === "playing" && room.phase === "drawing" && !chatLocked) {
      const result = await callCatch({ action: "guess", roomId: room.id, text: value });
      if (result.ok && result.correct) {
        void onReload();
        return;
      }
    }
    if (chatLocked) return;
    addChat({ name: myName, text: value });
    void channelRef.current?.send({ type: "broadcast", event: "chat", payload: { name: myName, text: value } });
  }

  const ranking = [...room.players].sort((a, b) => (room.scores[b.id] ?? 0) - (room.scores[a.id] ?? 0));
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // ★ scrollIntoView 는 게임 창까지 움직여서, 그리는 중에 채팅이 오면 화면이 돌아갔다
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat]);

  const seatsLeft = room.max_players - room.players.length;
  const canRecruit = joined && !room.is_test && seatsLeft > 0 && (room.status === "waiting" || room.status === "playing");
  const statusLabel =
    room.status === "waiting"
      ? "대기 중"
      : room.status === "playing"
        ? `문제 ${Math.min(room.turn_no + 1, room.turn_total)} / ${room.turn_total}`
        : room.status === "finished"
          ? "게임 종료"
          : "닫힌 방";

  return (
    <div className={`cmRoom ${typing ? "typing" : ""}`}>
      <div className="cmTop">
        <span className={`cmPill ${room.status}`}>{room.is_test ? "🧪 " : ""}{statusLabel}</span>
        <div className="cmWord">
          {room.status === "playing" ? (
            room.phase === "reveal" ? (
              <>
                <small>정답</small>
                <strong>{room.reveal_word ?? ""}</strong>
              </>
            ) : isDrawer ? (
              <>
                <small>제시어 · 나만 보여요</small>
                <strong className="secret">{word || "…"}</strong>
              </>
            ) : (
              <>
                <small>{room.drawer_name}님이 그리는 중</small>
                <strong>{room.hint ?? ""}</strong>
              </>
            )
          ) : room.status === "waiting" ? (
            <>
              <small>{room.host_name}님의 방</small>
              <strong>{room.players.length} / {room.max_players}명</strong>
            </>
          ) : (
            <>
              <small>최종 1위</small>
              <strong>{ranking[0]?.name ?? "-"}</strong>
            </>
          )}
        </div>
        <span className={`cmTime ${remaining <= 10 && room.phase === "drawing" ? "urgent" : ""}`}>
          {room.status === "playing" ? (room.phase === "drawing" ? `${remaining}″` : "…") : ""}
        </span>
      </div>
      {room.status === "playing" && room.phase === "drawing" && (
        <div className="cmTimer">
          <div style={{ width: `${Math.min(100, (remaining / DRAW_SECONDS) * 100)}%` }} className={remaining <= 10 ? "urgent" : ""} />
        </div>
      )}

      <div className="cmMain">
        <div className="cmStage">
          <div className="catchCanvasWrap">
            <canvas
              ref={canvasRef}
              className={`catchCanvas ${isDrawer ? "drawing" : ""}`}
              data-lock-scroll={isDrawer ? "true" : undefined}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerDown={(event) => {
                if (!isDrawer) return;
                touchInput();
                event.currentTarget.setPointerCapture(event.pointerId);
                const p = point(event);
                const stroke: Stroke = { sid: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, color, size, pts: [p] };
                drawingRef.current = stroke;
                strokesRef.current.push(stroke);
                pendingRef.current = [p];
                paintStroke(stroke);
              }}
              onPointerMove={(event) => {
                const stroke = drawingRef.current;
                if (!isDrawer || !stroke) return;
                touchInput();
                const p = point(event);
                const from = stroke.pts.length;
                stroke.pts.push(p);
                pendingRef.current.push(p);
                paintStroke(stroke, from);
              }}
              onPointerUp={() => {
                flush();
                drawingRef.current = null;
              }}
              onPointerCancel={() => {
                flush();
                drawingRef.current = null;
              }}
            />
            {watchIdle && drawerIdle >= DRAWER_WARN_MS && (
              <div className="cmIdleWarn" role="alert">
                ⏳ {Math.max(1, Math.ceil((DRAWER_KICK_MS - drawerIdle) / 1000))}초간 입력이 없으면 내보내집니다
              </div>
            )}
            {room.status === "waiting" && (
              <div className="catchOverlay">
                <span className="cmOverlayIcon">🎨</span>
                <strong>{room.players.length < minPlayers ? "참가자를 기다리고 있어요" : isHost ? "준비되면 시작을 눌러 주세요" : "곧 시작해요"}</strong>
                <span>
                  {room.players.length < minPlayers
                    ? "2명 이상 모이면 방장이 시작할 수 있어요"
                    : `${room.players.length}명 · 한 사람당 ${room.rounds}번씩 그려요`}
                </span>
              </div>
            )}
            {room.status === "playing" && room.phase === "reveal" && (
              <div className="catchOverlay reveal">
                <span className="cmOverlayIcon">{room.last_winner ? "🎉" : "⏰"}</span>
                <strong>{room.last_winner ? `${room.last_winner}님 정답!` : "아무도 못 맞혔어요"}</strong>
                <span>정답은 「{room.reveal_word}」</span>
              </div>
            )}
            {room.status === "finished" && (
              <div className="catchOverlay result">
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
                {joined && (
                  <div className="cmResultActions">
                    <button className="smallButton ghost" onClick={onBack}>게임 종료</button>
                    <button className="primaryButton" disabled={busy} onClick={onRestart}>🔁 다시하기</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {isDrawer && (
            <div className="cmTools" role="toolbar" aria-label="그리기 도구">
              <div className="cmColors">
                {COLORS.map((item) => (
                  <button
                    key={item}
                    className={`catchColor ${color === item ? "active" : ""} ${item === "#ffffff" ? "eraser" : ""}`}
                    style={{ background: item }}
                    aria-label={item === "#ffffff" ? "지우개" : `색 ${item}`}
                    title={item === "#ffffff" ? "지우개" : undefined}
                    onClick={() => {
                      setColor(item);
                      touchInput();
                    }}
                  >
                    {item === "#ffffff" ? "⌫" : ""}
                  </button>
                ))}
              </div>
              <div className="cmSizes">
                {SIZES.map((item) => (
                  <button
                    key={item}
                    className={`catchSize ${size === item ? "active" : ""}`}
                    aria-label={`굵기 ${item}`}
                    onClick={() => {
                      setSize(item);
                      touchInput();
                    }}
                  >
                    <i style={{ width: Math.max(4, item / 2), height: Math.max(4, item / 2) }} />
                  </button>
                ))}
                <button
                  className="cmClear"
                  onClick={() => {
                    touchInput();
                    strokesRef.current = [];
                    redraw();
                    void channelRef.current?.send({ type: "broadcast", event: "clear", payload: { turn: turnKeyRef.current } });
                  }}
                >
                  모두 지우기
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="cmSide">
          <ul className="cmPlayers">
            {room.players.map((player) => {
              const drawing = room.status === "playing" && player.id === room.drawer_member;
              return (
                <li key={player.id} className={`${drawing ? "drawer" : ""} ${player.id === me ? "me" : ""}`}>
                  <span className="cmAvatar">{drawing ? "✏️" : player.name.slice(0, 1)}</span>
                  <span className="cmName">
                    {player.name}
                    {player.id === room.host_member && <em>방장</em>}
                  </span>
                  <b>{room.scores[player.id] ?? 0}</b>
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, seatsLeft) }, (_, i) => (
              <li key={`empty${i}`} className="empty">
                <span className="cmAvatar" />
                <span className="cmName">빈 자리</span>
              </li>
            ))}
          </ul>

          <div className="cmChat">
            <div className="catchChatLog" ref={chatLogRef}>
              {chat.length === 0 && <span className="muted">정답은 여기에 입력하세요.</span>}
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
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onFocus={(event) => {
                    // 키보드가 올라오면 그림판을 줄이고 입력칸이 보이게
                    setTyping(true);
                    const input = event.currentTarget;
                    window.setTimeout(() => input.scrollIntoView({ block: "nearest", behavior: "smooth" }), 250);
                  }}
                  onBlur={() => setTyping(false)}
                  enterKeyHint="send"
                  autoComplete="off"
                  placeholder={chatLocked ? "그리는 중에는 입력할 수 없어요" : room.phase === "drawing" ? "정답 입력" : "채팅"}
                  disabled={chatLocked}
                  maxLength={40}
                  aria-label="채팅 입력"
                />
                <button type="submit" disabled={chatLocked} aria-label="보내기">↑</button>
              </form>
            )}
          </div>
        </aside>
      </div>

      <div className="cmActions">
        <button className="smallButton ghost" onClick={onBack}>← 방 목록</button>
        <div className="cmActionsMain">
          {!joined && (room.status === "waiting" || room.status === "playing") && (
            <button className="primaryButton" disabled={busy || seatsLeft <= 0} onClick={onJoin}>
              {seatsLeft <= 0 ? "방이 가득 찼어요" : "참가하기"}
            </button>
          )}
          {joined && room.status === "finished" && (
            <button className="primaryButton" disabled={busy} onClick={onRestart}>
              🔁 다시하기 ({room.players.length}명)
            </button>
          )}
          {canRecruit && (
            <button className="smallButton cmRecruit" disabled={busy} onClick={onRecruit}>
              📣 모집하기
            </button>
          )}
          {joined && isHost && room.status === "waiting" && (
            <button className="primaryButton" disabled={busy || room.players.length < minPlayers} onClick={onStart}>
              ▶ 시작 ({room.players.length}명)
            </button>
          )}
          {joined && (room.status === "waiting" || room.status === "playing") && (
            <button className="smallButton ghost danger" disabled={busy} onClick={onLeave}>나가기</button>
          )}
        </div>
      </div>
    </div>
  );
}
