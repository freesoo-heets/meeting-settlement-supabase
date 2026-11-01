"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// 🤖 봇관리 (관리자): 봇 스크립트 목록 · 수정 · 추가 · 삭제. 저장은 초안이고, 운영진방 !봇적용 때 봇에 반영된다

type Row = { name: string; size: number; changed: boolean; deleted: boolean; is_new: boolean; updated_by: string | null; updated_at: string };
type Script = { name: string; content: string; changed: boolean; deleted: boolean; is_new: boolean; updated_at: string };
type Result = { ok: boolean; error?: string; rows?: Row[]; script?: Script; updatedAt?: string };
type Editing = { name: string; text: string; saved: string; crlf: boolean; updatedAt: string | null };

const KEEP_FILES = new Set(["irispy.py", "bot_updater.py"]);
const SECRET_MARK = "__BOT_SECRET_";

async function callBot(payload: Record<string, unknown>): Promise<Result> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "로그인이 필요합니다." };
  const response = await fetch("/api/bot-scripts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return (await response.json().catch(() => ({ ok: false, error: "응답 오류" }))) as Result;
}

function statusOf(row: Row) {
  if (row.deleted) return { label: "삭제 대기", tone: "del" };
  if (row.is_new) return { label: "새 파일", tone: "new" };
  return row.changed ? { label: "수정됨", tone: "edit" } : { label: "적용됨", tone: "" };
}

const sizeText = (size: number) => (size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`);

export default function BotAdmin({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await callBot({ action: "list" });
    if (!result.ok) return setNote(`❌ ${result.error ?? "불러오지 못했습니다."}`);
    setRows(result.rows ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => {
    const word = search.trim().toLowerCase();
    return (rows ?? []).filter((row) => row.name.toLowerCase().includes(word));
  }, [rows, search]);
  const pending = (rows ?? []).filter((row) => row.changed).length;
  const dirty = !!editing && editing.text !== editing.saved;

  async function open(name: string) {
    setBusy(true);
    const result = await callBot({ action: "read", name });
    setBusy(false);
    if (!result.ok || !result.script) return setNote(`❌ ${result.error ?? "열지 못했습니다."}`);
    const { content, updated_at } = result.script;
    // 입력칸은 줄바꿈을 \n 으로 바꾸므로, 안 고친 줄까지 바뀐 것처럼 보이지 않게 저장할 때 되돌린다
    const text = content.replace(/\r\n/g, "\n");
    setNote("");
    setEditing({ name, text, saved: text, crlf: content.includes("\r\n"), updatedAt: updated_at });
  }

  function create() {
    const name = (newName ?? "").trim();
    const file = name.endsWith(".py") ? name : `${name}.py`;
    if (!/^[A-Za-z0-9_-]+\.py$/.test(file)) return setNote("❌ 영문 · 숫자 · _ · - 로 된 이름만 쓸 수 있어요.");
    if ((rows ?? []).some((row) => row.name === file)) return setNote("❌ 같은 이름의 파일이 이미 있어요.");
    setNote("");
    setNewName(null);
    setEditing({ name: file, text: "", saved: "", crlf: false, updatedAt: null });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    const content = editing.crlf ? editing.text.replace(/\n/g, "\r\n") : editing.text;
    const result = await callBot({ action: "save", name: editing.name, content, expected: editing.updatedAt });
    setBusy(false);
    if (!result.ok) return setNote(`❌ ${result.error ?? "저장하지 못했습니다."}`);
    setEditing({ ...editing, saved: editing.text, updatedAt: result.updatedAt ?? editing.updatedAt });
    setNote("✅ 저장했어요. 운영진방에서 !봇적용 을 입력하면 봇에 반영됩니다.");
    await refresh();
  }

  async function change(action: "remove" | "revert", name: string, question: string) {
    if (!window.confirm(question)) return;
    setBusy(true);
    const result = await callBot({ action, name });
    setBusy(false);
    if (!result.ok) return setNote(`❌ ${result.error ?? "처리하지 못했습니다."}`);
    setEditing(null);
    setNote(action === "remove" ? `🗑️ ${name}: 운영진방 !봇적용 때 지워집니다.` : `↩️ ${name}: 고친 내용을 취소했어요.`);
    await refresh();
  }

  function close() {
    if (editing) {
      if (dirty && !window.confirm("저장하지 않은 내용이 있어요. 닫을까요?")) return;
      setNote("");
      return setEditing(null);
    }
    onClose();
  }

  const row = editing ? rows?.find((item) => item.name === editing.name) : undefined;

  return (
    <div className="botAdmin" role="dialog" aria-modal="true" aria-label="봇관리">
      <div className="botAdminHead">
        <strong>{editing ? editing.name : "🤖 봇관리"}</strong>
        <button aria-label={editing ? "목록으로" : "닫기"} onClick={close}>{editing ? "←" : "×"}</button>
      </div>
      {note && <p className="botAdminNote">{note}</p>}

      {editing ? (
        <>
          {editing.text.includes(SECRET_MARK) && <p className="botAdminHint">🔒 __BOT_SECRET_…__ 은 API 키를 가린 표시예요. 그대로 두면 적용할 때 원래 키로 채워집니다.</p>}
          <textarea
            className="botAdminCode"
            value={editing.text}
            onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            spellCheck={false}
            wrap="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="스크립트 내용"
          />
          <div className="botAdminActions">
            <button className="smallButton" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "저장 중…" : "저장"}</button>
            {row?.changed && !row.is_new && (
              <button className="smallButton ghost" disabled={busy} onClick={() => void change("revert", editing.name, `${editing.name} 의 고친 내용을 취소할까요?`)}>변경 취소</button>
            )}
            {row && !row.deleted && !KEEP_FILES.has(editing.name) && (
              <button className="smallButton danger" disabled={busy} onClick={() => void change("remove", editing.name, `${editing.name} 을(를) 삭제할까요?`)}>삭제</button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="botAdminTools">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="파일 검색" autoComplete="off" aria-label="파일 검색" />
            <button className="smallButton" onClick={() => setNewName(newName === null ? "" : null)}>새 파일</button>
          </div>
          {newName !== null && (
            <form
              className="botAdminTools"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="파일 이름 (예: my_helper.py)" autoComplete="off" autoFocus aria-label="새 파일 이름" />
              <button type="submit" className="smallButton">만들기</button>
            </form>
          )}
          {pending > 0 && <p className="botAdminPending">📝 적용 대기 {pending}개 · 운영진방에서 <b>!봇적용</b></p>}
          <div className="botAdminList">
            {rows === null && !note && <span className="muted">불러오는 중…</span>}
            {rows?.length === 0 && <span className="muted">아직 올라온 스크립트가 없어요. 봇을 재시작하거나 운영진방에서 !봇올리기 를 입력해 주세요.</span>}
            {shown.map((item) => {
              const status = statusOf(item);
              return (
                <button key={item.name} disabled={busy} onClick={() => void open(item.name)}>
                  <b>{item.name}</b>
                  <span>{sizeText(item.size)}{item.changed && item.updated_by ? ` · ${item.updated_by}` : ""}</span>
                  <em className={status.tone}>{status.label}</em>
                </button>
              );
            })}
          </div>
          <p className="botAdminHint">저장만으로는 봇이 바뀌지 않아요. 운영진방에서 <b>!봇적용</b> · 대기 목록 <b>!봇변경</b> · 취소 <b>!봇되돌리기</b> · 다시 올리기 <b>!봇올리기</b></p>
        </>
      )}
    </div>
  );
}
