"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import OmokGame, { type Opponent } from "./OmokGame";
import AlkkagiGame from "./AlkkagiGame";
import CatchMindGame from "./CatchMindGame";

export type GameKind = "omok" | "alkkagi" | "catch";

type StakeRow = {
  id: string;
  status: string;
  stake: number;
  host_member: string;
  host_name: string;
  guest_member: string | null;
  guest_name: string | null;
  target_member: string | null;
  is_test?: boolean;
};

type CatchRow = {
  id: string;
  status: string;
  host_name: string;
  players: Array<{ id: string; name: string }>;
  max_players: number;
  turn_no: number;
  turn_total: number;
  is_test?: boolean;
};

type Props = {
  onClose: () => void;
  initial?: { kind: GameKind; id: string } | null;
  currentMemberId: string;
  myName: string;
  myPoints: number | null;
  myTickets: number | null;
  opponents: Opponent[];
  isAdmin?: boolean;
};

const STAKE_COLUMNS = "id,status,stake,host_member,host_name,guest_member,guest_name,target_member,is_test";

const GAMES: Array<{ kind: GameKind; icon: string; name: string; desc: string }> = [
  { kind: "omok", icon: "⚫", name: "오목", desc: "렌주룰 · 점수 내기 · 1:1" },
  { kind: "alkkagi", icon: "🥏", name: "알까기", desc: "장기알 · 점수 내기 · 1:1" },
  { kind: "catch", icon: "🎨", name: "캐치마인드", desc: "그림 맞히기 · 최대 6명 · 점수 없음" },
];

export default function GameHub({ onClose, initial, currentMemberId, myName, myPoints, myTickets, opponents, isAdmin }: Props) {
  const [active, setActive] = useState<{ kind: GameKind; id: string } | null>(initial ?? null);
  const [omok, setOmok] = useState<StakeRow[]>([]);
  const [alkkagi, setAlkkagi] = useState<StakeRow[]>([]);
  const [catchRooms, setCatchRooms] = useState<CatchRow[]>([]);

  const load = useCallback(async () => {
    const [o, a, c] = await Promise.all([
      supabase.from("omok_games").select(STAKE_COLUMNS).in("status", ["open", "challenge", "escrow", "playing"]).order("created_at", { ascending: false }).limit(20),
      supabase.from("alkkagi_games").select(STAKE_COLUMNS).in("status", ["open", "challenge", "escrow", "playing"]).order("created_at", { ascending: false }).limit(20),
      supabase.from("catch_rooms").select("id,status,host_name,players,max_players,turn_no,turn_total,is_test").in("status", ["waiting", "playing"]).order("created_at", { ascending: false }).limit(20),
    ]);
    // 테스트 판은 만든 관리자에게만 보인다
    const mineOrReal = (row: StakeRow) => !row.is_test || row.host_member === currentMemberId;
    setOmok(((o.data ?? []) as StakeRow[]).filter(mineOrReal));
    setAlkkagi(((a.data ?? []) as StakeRow[]).filter(mineOrReal));
    setCatchRooms(
      ((c.data ?? []) as CatchRow[]).filter(
        (row) => !row.is_test || row.players.some((player) => player.id === currentMemberId),
      ),
    );
  }, [currentMemberId]);

  useEffect(() => {
    if (active) return;
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load, active]);

  const back = () => setActive(null);

  if (active?.kind === "omok") {
    return (
      <OmokGame
        onClose={onClose}
        onBack={back}
        initialGameId={active.id}
        currentMemberId={currentMemberId}
        myName={myName}
        myPoints={myPoints}
        myTickets={myTickets}
        opponents={opponents}
        isAdmin={isAdmin}
      />
    );
  }
  if (active?.kind === "alkkagi") {
    return (
      <AlkkagiGame
        onClose={onClose}
        onBack={back}
        initialGameId={active.id}
        currentMemberId={currentMemberId}
        myName={myName}
        myPoints={myPoints}
        myTickets={myTickets}
        opponents={opponents}
        isAdmin={isAdmin}
      />
    );
  }
  if (active?.kind === "catch") {
    return (
      <CatchMindGame
        onClose={onClose}
        onBack={back}
        initialRoomId={active.id}
        currentMemberId={currentMemberId}
        myName={myName}
        isAdmin={isAdmin}
      />
    );
  }

  const stakeLine = (row: StakeRow) => {
    if (row.is_test) return `🧪 테스트 대국 · ${row.host_name}`;
    if (row.status === "playing" || row.status === "escrow") return `${row.host_name} vs ${row.guest_name ?? "?"} · 진행 중`;
    if (row.status === "challenge") return `${row.host_name} → 대국신청 · 수락 대기`;
    return `${row.host_name} · 상대 구함`;
  };
  const stakeAction = (row: StakeRow) => {
    const mine = row.host_member === currentMemberId || row.guest_member === currentMemberId;
    if (mine) return "내 대국";
    if (row.status === "open") return "도전";
    if (row.status === "challenge" && row.target_member === currentMemberId) return "수락";
    return "관전";
  };

  const sections: Record<GameKind, Array<{ id: string; line: string; sub: string; action: string; hot: boolean }>> = {
    omok: omok.map((row) => ({
      id: row.id,
      line: stakeLine(row),
      sub: `💎 ${row.stake.toLocaleString("ko-KR")}점`,
      action: stakeAction(row),
      hot: row.status === "open" || (row.status === "challenge" && row.target_member === currentMemberId),
    })),
    alkkagi: alkkagi.map((row) => ({
      id: row.id,
      line: stakeLine(row),
      sub: `💎 ${row.stake.toLocaleString("ko-KR")}점`,
      action: stakeAction(row),
      hot: row.status === "open" || (row.status === "challenge" && row.target_member === currentMemberId),
    })),
    catch: catchRooms.map((row) => ({
      id: row.id,
      line: `${row.host_name}님의 방 · ${row.status === "waiting" ? "대기 중" : `진행 중 ${Math.min(row.turn_no + 1, row.turn_total)}/${row.turn_total}`}`,
      sub: `👥 ${row.players.length}/${row.max_players}명`,
      action: row.players.some((player) => player.id === currentMemberId)
        ? "내 방"
        : row.players.length >= row.max_players
          ? "관전"
          : "참가",
      hot: row.status === "waiting" && row.players.length < row.max_players,
    })),
  };

  return (
    <div
      className="meetingModalBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal gameHubModal" role="dialog" aria-modal="true">
        <div className="meetingModalHeader">
          <div>
            <span>내 점수 💎 {myPoints !== null ? myPoints.toLocaleString("ko-KR") : "-"} · 티켓 🎫 {myTickets ?? "-"}</span>
            <h2>🎮 게임</h2>
          </div>
          <button className="modalCloseButton" onClick={onClose}>×</button>
        </div>

        <div className="gameHubGrid">
          {GAMES.map((game) => {
            const rows = sections[game.kind];
            return (
              <article className={`gameHubCard ${game.kind}`} key={game.kind}>
                <div className="gameHubHead">
                  <span className="gameHubIcon" aria-hidden="true">{game.icon}</span>
                  <div>
                    <strong>{game.name}</strong>
                    <span>{game.desc}</span>
                  </div>
                  <button className="smallButton" onClick={() => setActive({ kind: game.kind, id: "" })}>
                    {game.kind === "catch" ? "방 만들기" : "대국 만들기"}
                  </button>
                </div>
                <div className="gameHubRooms">
                  {rows.length === 0 && <span className="muted">열린 방이 없습니다.</span>}
                  {rows.map((row) => (
                    <button
                      key={row.id}
                      className={`gameHubRoom ${row.hot ? "hot" : ""}`}
                      onClick={() => setActive({ kind: game.kind, id: row.id })}
                    >
                      <span>
                        <b>{row.line}</b>
                        <em>{row.sub}</em>
                      </span>
                      <i>{row.action} →</i>
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
