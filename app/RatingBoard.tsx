"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { PLACEMENT_GAMES, type RatingRow } from "../lib/rating";

// 🏆 오목·알까기 레이팅 랭킹 (누적 / 이번 달)

type Kind = "omok" | "alkkagi";
type Data = { me: string; names: Record<string, string>; all: RatingRow[]; month: RatingRow[] };

async function fetchRating(kind: Kind, game?: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");
  const response = await fetch(`/api/rating?kind=${kind}${game ? `&game=${game}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({ ok: false, error: "응답 오류" }));
  if (!json.ok) throw new Error(json.error ?? "불러오지 못했습니다.");
  return json;
}

// 종료 팝업용: 이 대국의 레이팅 변동
export function useRatingChange(kind: Kind, gameId: string | null, enabled: boolean) {
  const [change, setChange] = useState<{ host: number; guest: number; hostAfter: number; guestAfter: number } | null>(null);
  useEffect(() => {
    setChange(null);
    if (!enabled || !gameId) return;
    let alive = true;
    fetchRating(kind, gameId)
      .then((json) => alive && setChange(json.change ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kind, gameId, enabled]);
  return change;
}

const KIND_LABEL: Record<Kind, string> = { omok: "⚫ 오목", alkkagi: "🥏 알까기" };

export default function RatingBoard({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("omok");
  const [period, setPeriod] = useState<"all" | "month">("all");
  const [data, setData] = useState<Partial<Record<Kind, Data>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setError("");
    fetchRating(kind)
      .then((json) => alive && setData((prev) => ({ ...prev, [kind]: json as Data })))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [kind]);

  const current = data[kind];
  const rows = current ? current[period] : [];
  const ranked = rows.filter((row) => !row.placement);
  const placing = rows.filter((row) => row.placement);
  const nameOf = (id: string) => current?.names[id] ?? "(탈퇴)";

  const line = (row: RatingRow, rank: number | null) => {
    const rate = row.games ? Math.round(((row.wins + row.draws / 2) / row.games) * 100) : 0;
    return (
      <tr key={row.memberId} className={row.memberId === current?.me ? "me" : ""}>
        <td className="rank">{rank === null ? "-" : rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}</td>
        <td className="name">{nameOf(row.memberId)}</td>
        <td className="rating">{row.rating}</td>
        <td className="record">
          {row.wins}승 {row.losses}패{row.draws ? ` ${row.draws}무` : ""}
          <small>{rate}%</small>
        </td>
        <td className="recent">
          {row.recent.map((mark, index) => (
            <i key={index} className={mark}>{mark === "W" ? "○" : mark === "L" ? "●" : "△"}</i>
          ))}
        </td>
      </tr>
    );
  };

  return (
    <div
      className="meetingModalBackdrop gameBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal ratingModal" role="dialog" aria-modal="true" aria-label="레이팅 랭킹">
        <div className="meetingModalHeader">
          <div>
            <span>이기면 오르고 지면 내려가요 · 친선전 포함</span>
            <h2>🏆 랭킹</h2>
          </div>
          <button className="modalCloseButton" onClick={onClose}>×</button>
        </div>

        <div className="ratingTabs">
          {(["omok", "alkkagi"] as Kind[]).map((item) => (
            <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>
              {KIND_LABEL[item]}
            </button>
          ))}
        </div>
        <div className="ratingTabs small">
          <button className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>누적</button>
          <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>이번 달</button>
        </div>

        {error && <div className="omokMessage">{error}</div>}
        {!current && !error && <p className="muted ratingEmpty">불러오는 중…</p>}
        {current && rows.length === 0 && <p className="muted ratingEmpty">아직 끝난 대국이 없어요.</p>}

        {current && ranked.length > 0 && (
          <table className="ratingTable">
            <thead>
              <tr><th>순위</th><th>닉네임</th><th>레이팅</th><th>전적</th><th>최근</th></tr>
            </thead>
            <tbody>{ranked.map((row, index) => line(row, index + 1))}</tbody>
          </table>
        )}
        {current && placing.length > 0 && (
          <>
            <h3 className="ratingSub">배치 중 ({PLACEMENT_GAMES}판 미만)</h3>
            <table className="ratingTable placing">
              <tbody>{placing.map((row) => line(row, null))}</tbody>
            </table>
          </>
        )}
        <p className="muted ratingNote">
          모두 1000점에서 시작해요. 강한 상대를 이기면 많이 오르고, 처음 {PLACEMENT_GAMES}판은 변동이 2배예요. 봇 포인트와는 별개입니다.
        </p>
      </section>
    </div>
  );
}
