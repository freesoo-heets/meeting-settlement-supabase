"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// 캐치마인드 최근 그림 갤러리 (문제가 끝날 때 출제자 화면이 저장한 그림)

type SavedStroke = { color: string; size: number; pts: Array<[number, number]> };
type Drawing = {
  id: string;
  drawer_name: string;
  word: string;
  winner: string | null;
  strokes: SavedStroke[];
  created_at: string;
};

const CANVAS_W = 800;
const CANVAS_H = 560;

function paint(canvas: HTMLCanvasElement | null, strokes: SavedStroke[]) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (!stroke.pts?.length) continue;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    const pts = stroke.pts.map(([x, y]) => [x * CANVAS_W, y * CANVAS_H]);
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}

function DrawingCanvas({ strokes, className }: { strokes: SavedStroke[]; className: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => paint(ref.current, strokes), [strokes]);
  return <canvas ref={ref} className={className} width={CANVAS_W} height={CANVAS_H} />;
}

function when(value: string) {
  return new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CatchGallery() {
  const [items, setItems] = useState<Drawing[] | null>(null);
  const [open, setOpen] = useState<Drawing | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase
      .from("catch_drawings")
      .select("id,drawer_name,word,winner,strokes,created_at")
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(24)
      .then(({ data, error }) => {
        if (alive) setItems(error ? [] : ((data ?? []) as Drawing[]));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!items) return null;

  return (
    <div className="omokSection">
      <strong>최근 그림</strong>
      {items.length === 0 && <span className="muted">아직 저장된 그림이 없습니다. 게임을 하면 여기에 쌓여요.</span>}

      {open && (
        <div className="cgOpen">
          <DrawingCanvas strokes={open.strokes} className="cgBig" />
          <div className="cgOpenInfo">
            <span>
              <b>{open.drawer_name}</b>님이 그린 <b className="cgWord">「{open.word}」</b>
            </span>
            <span className="muted">
              {open.winner ? `🎉 ${open.winner}님 정답` : "⏰ 아무도 못 맞힘"} · {when(open.created_at)}
            </span>
            <button className="smallButton ghost" onClick={() => setOpen(null)}>닫기</button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="cgGrid">
          {items.map((item) => (
            <button
              key={item.id}
              className={`cgItem ${open?.id === item.id ? "active" : ""}`}
              onClick={() => setOpen(item)}
              aria-label={`${item.drawer_name}님이 그린 ${item.word}`}
            >
              <DrawingCanvas strokes={item.strokes} className="cgThumb" />
              <span className="cgCaption">
                <b>{item.word}</b>
                <em>✏️ {item.drawer_name} · {item.winner ? `🎉 ${item.winner}` : "⏰ 실패"}</em>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
