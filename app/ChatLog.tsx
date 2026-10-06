"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// 회원현황: 마지막 채팅 시각 · 📜 채팅 내역 (카톡 봇의 !유령 · !채팅기록 과 같은 자료)

async function call(path: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return response.json().catch(() => ({ ok: false, error: "응답 오류" }));
}

// 이름 → 마지막 채팅 시각. 1분마다 새로 받는다.
export function useLastChats(enabled: boolean) {
  const [last, setLast] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      call("/api/chatlog").then((json) => {
        if (alive && json?.ok) setLast(json.last ?? {});
      });
    void load();
    const timer = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return last;
}

export function chatAgo(iso: string | undefined, now = Date.now()) {
  if (!iso) return "기록 없음";
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

const PAGE_SIZE = 300;

// '26/10/07' → '2026.10.07 (수)'
function dayLabel(day: string) {
  const [yy, mm, dd] = day.split("/").map(Number);
  if (!yy || !mm || !dd) return day;
  const date = new Date(2000 + yy, mm - 1, dd);
  return `${2000 + yy}.${String(mm).padStart(2, "0")}.${String(dd).padStart(2, "0")} (${"일월화수목금토"[date.getDay()]})`;
}

type Chat = { name: string; full_nick: string | null; last_chat_at: string | null; messages: Array<{ t: string; m: string }> };

export function ChatLogModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0); // 0 = 가장 최근 500개
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    call(`/api/chatlog?name=${encodeURIComponent(name)}`).then((json) => {
      if (!alive) return;
      if (!json?.ok) setError(json?.error ?? "불러오지 못했습니다.");
      else if (!json.chat) setError("아직 채팅 기록이 없어요.");
      else setChat(json.chat as Chat);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  const all = (chat?.messages ?? []).filter((row) => !query || row.m.includes(query));
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const end = all.length - current * PAGE_SIZE;
  // 최근 채팅이 위로
  const rows = all.slice(Math.max(0, end - PAGE_SIZE), end).reverse();

  // 같은 날짜끼리 묶기 ('26/10/07 14:03:11' → 날짜 '26/10/07', 시각 '14:03')
  const groups: Array<{ day: string; items: Array<{ time: string; m: string }> }> = [];
  for (const row of rows) {
    const [day = "", time = ""] = row.t.split(" ");
    const last = groups[groups.length - 1];
    const item = { time: time.slice(0, 5), m: row.m.replace(/\s*\n\s*/g, " ") };
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }

  // 열 때 · 페이지 · 검색이 바뀔 때 맨 위(최신)로
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [chat, current, query]);

  return (
    <div
      className="meetingModalBackdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="meetingModal chatLogModal" role="dialog" aria-modal="true" aria-label={`${name} 채팅 내역`}>
        <div className="meetingModalHeader">
          <div>
            <span>{chat?.full_nick ?? name} · 마지막 채팅 {chatAgo(chat?.last_chat_at ?? undefined)}</span>
            <h2>📜 채팅 내역</h2>
          </div>
          <button className="modalCloseButton" onClick={onClose}>×</button>
        </div>
        {chat && (
          <input
            className="chatLogSearch"
            type="search"
            placeholder="내용 검색"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        )}
        {error && <p className="muted chatLogEmpty">{error}</p>}
        {!chat && !error && <p className="muted chatLogEmpty">불러오는 중…</p>}
        {chat && (
          <div className="chatLogList" ref={logRef}>
            {rows.length === 0 && <p className="muted chatLogEmpty">검색 결과가 없어요.</p>}
            {groups.map((group) => (
              <section className="chatLogDay" key={group.day}>
                <h4>{dayLabel(group.day)}</h4>
                {group.items.map((item, index) => (
                  <div className="chatLogLine" key={index}>
                    <time>{item.time}</time>
                    <span>{item.m}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
        {chat && pages > 1 && (
          <div className="chatLogPager">
            <button type="button" className="smallButton ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
              ← 최근
            </button>
            <span>{current + 1} / {pages} 페이지</span>
            <button type="button" className="smallButton ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              이전 {PAGE_SIZE}개 →
            </button>
          </div>
        )}
        <p className="muted chatLogNote">{query ? `검색 ${all.length.toLocaleString("ko-KR")}개 · ` : ""}전체 {(chat?.messages.length ?? 0).toLocaleString("ko-KR")}개 (최대 5,000개) · 카톡방 일반 채팅만 (명령어 제외) · 운영진과 본인만 볼 수 있어요</p>
      </section>
    </div>
  );
}
