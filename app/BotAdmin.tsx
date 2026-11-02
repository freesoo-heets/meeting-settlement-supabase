"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { diffCount, parseDiff, unifiedDiff } from "../lib/lineDiff";

// 🤖 봇관리 (관리자): 봇 스크립트 목록 · 수정 · 추가 · 삭제 · 변경 내역. 저장은 초안이고, 운영진방 !봇적용 때 봇에 반영된다

type Row = { name: string; size: number; changed: boolean; deleted: boolean; is_new: boolean; updated_by: string | null; updated_at: string };
type Script = { name: string; content: string; live: string | null; changed: boolean; deleted: boolean; is_new: boolean; updated_at: string };
type LogRow = { id: string; name: string; action: string; diff: string; plus: number; minus: number; edited_by: string | null; applied_by: string | null; applied_at: string };
type Command = { state: string; result: string | null };
type RunRow = Command & { id: string; action: string; requested_by: string; created_at: string };
type Result = { ok: boolean; error?: string; id?: string; rows?: Row[]; script?: Script; pending?: Script[]; log?: LogRow[]; runs?: RunRow[]; updatedAt?: string; command?: Command };
type Editing = { name: string; text: string; saved: string; live: string | null; crlf: boolean; updatedAt: string | null };

const KEEP_FILES = new Set(["irispy.py", "bot_updater.py"]);
const SECRET_MARK = "__BOT_SECRET_";
const ACTION_LABEL: Record<string, string> = { edit: "수정", add: "새 파일", delete: "삭제", revert: "되돌림" };
const RUN_LABEL: Record<string, string> = { apply: "적용", revert: "되돌리기", upload: "다시 올리기" };
const RUN_STATE: Record<string, { label: string; tone: string }> = {
  requested: { label: "대기", tone: "edit" },
  running: { label: "진행 중", tone: "edit" },
  done: { label: "완료", tone: "new" },
  failed: { label: "실패", tone: "del" },
};
const RUN_POLL_MS = 2000;
const RUN_WAIT_MS = 150000; // 재시작 · 자동 복구까지 기다리는 시간 (봇 bot_guard 의 CHECK_TIMEOUT 보다 길게)
const RUN_TEXT: Record<string, { ask: string; wait: string }> = {
  apply: { ask: "봇에 적용하고 재시작할까요?", wait: "⏳ 봇이 적용하고 재시작하는 중… (약 30초)" },
  revert: { ask: "마지막 적용을 되돌리고 재시작할까요?", wait: "⏳ 봇이 되돌리고 재시작하는 중… (약 30초)" },
  upload: { ask: "봇의 지금 파일을 사이트에 다시 올릴까요?", wait: "⏳ 봇이 파일을 올리는 중…" },
};

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

function statusOf(row: { changed: boolean; deleted: boolean; is_new: boolean }) {
  if (row.deleted) return { label: "삭제 대기", tone: "del" };
  if (row.is_new) return { label: "새 파일", tone: "new" };
  return row.changed ? { label: "수정됨", tone: "edit" } : { label: "적용됨", tone: "" };
}

const sizeText = (size: number) => (size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`);
const whenText = (at: string) => new Date(at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  if (lines.length === 0) return <p className="botAdminHint">바뀐 내용이 없어요.</p>;
  return (
    <div className="botDiff">
      {lines.map((line, index) => (
        <div key={index} className={`botDiffLine ${line.kind}`}>
          <i>{line.oldNo ?? ""}</i>
          <i>{line.newNo ?? ""}</i>
          <code>{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}{line.text}</code>
        </div>
      ))}
    </div>
  );
}

function PendingCard({ script }: { script: Script }) {
  const diff = useMemo(() => (script.deleted ? "" : unifiedDiff(script.live ?? "", script.content)), [script]);
  const { plus, minus } = diffCount(diff);
  const status = statusOf(script);
  return (
    <details className="botChange" open>
      <summary>
        <b>{script.name}</b>
        <em className={status.tone}>{status.label}</em>
        {!script.deleted && <span><u>+{plus}</u> <s>-{minus}</s></span>}
      </summary>
      {script.deleted ? <p className="botAdminHint">!봇적용 때 이 파일이 지워집니다.</p> : <DiffView diff={diff} />}
    </details>
  );
}

function LogCard({ row, showName }: { row: LogRow; showName: boolean }) {
  return (
    <details className="botChange">
      <summary>
        {showName && <b>{row.name}</b>}
        <em>{ACTION_LABEL[row.action] ?? row.action}</em>
        {row.diff && <span><u>+{row.plus}</u> <s>-{row.minus}</s></span>}
        <small>{whenText(row.applied_at)}{row.edited_by ? ` · ${row.edited_by}` : ""}</small>
      </summary>
      <p className="botAdminHint">적용: {row.applied_by ?? "-"}</p>
      {row.diff ? <DiffView diff={row.diff} /> : <p className="botAdminHint">{row.action === "revert" ? "이전 내용으로 되돌렸어요." : "내용 기록이 없어요."}</p>}
    </details>
  );
}

function RunCard({ row }: { row: RunRow }) {
  const state = RUN_STATE[row.state] ?? { label: row.state, tone: "" };
  return (
    <details className="botChange" open={row.state === "failed"}>
      <summary>
        <b>{RUN_LABEL[row.action] ?? row.action}</b>
        <em className={state.tone}>{state.label}</em>
        <small>{whenText(row.created_at)} · {row.requested_by}</small>
      </summary>
      <pre className="botLog">{row.result ?? "기록이 없어요."}</pre>
    </details>
  );
}

export default function BotAdmin({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [tab, setTab] = useState<"code" | "diff">("code");
  const [newName, setNewName] = useState<string | null>(null);
  const [changes, setChanges] = useState<{ pending: Script[]; log: LogRow[]; runs: RunRow[] } | null>(null);
  const [runLog, setRunLog] = useState("");
  const [fileLog, setFileLog] = useState<LogRow[]>([]);

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
  const editingDiff = useMemo(
    () => (editing && tab === "diff" ? unifiedDiff(editing.live ?? "", editing.text) : ""),
    [editing, tab],
  );

  async function open(name: string) {
    setBusy(true);
    const result = await callBot({ action: "read", name });
    setBusy(false);
    if (!result.ok || !result.script) return setNote(`❌ ${result.error ?? "열지 못했습니다."}`);
    const { content, live, updated_at } = result.script;
    // 입력칸은 줄바꿈을 \n 으로 바꾸므로, 안 고친 줄까지 바뀐 것처럼 보이지 않게 저장할 때 되돌린다
    const text = content.replace(/\r\n/g, "\n");
    setNote("");
    setTab("code");
    setFileLog([]);
    setEditing({ name, text, saved: text, live, crlf: content.includes("\r\n"), updatedAt: updated_at });
  }

  async function showFileDiff() {
    if (!editing) return;
    setTab("diff");
    const result = await callBot({ action: "changes", name: editing.name });
    setFileLog(result.log ?? []);
  }

  // 봇에게 요청하고 끝날 때까지 기다린다. 창을 닫아도 봇은 처리하고 결과는 운영진방에 올라간다
  async function run(command: "apply" | "revert" | "upload") {
    const files = (rows ?? []).filter((item) => item.changed).map((item) => item.name);
    const list = command === "apply" && files.length ? `\n\n${files.join("\n")}` : "";
    if (!window.confirm(`${RUN_TEXT[command].ask}${list}\n\n운영진방에 알림이 올라갑니다.`)) return;
    setBusy(true);
    setRunLog("");
    const started = await callBot({ action: "run", command });
    if (!started.ok || !started.id) {
      setBusy(false);
      return setNote(`❌ ${started.error ?? "요청하지 못했습니다."}`);
    }
    setNote(RUN_TEXT[command].wait);
    const deadline = Date.now() + RUN_WAIT_MS;
    let done: Command | undefined;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
      const status = await callBot({ action: "runStatus", id: started.id });
      if (status.command && status.command.state !== "requested" && status.command.state !== "running") {
        done = status.command;
        break;
      }
    }
    setBusy(false);
    setNote(done ? (done.state === "failed" ? "❌ 적용하지 못했어요. 아래 로그를 확인해 주세요." : "✅ 끝났어요.") : "⚠️ 봇이 아직 답하지 않아요. 켜져 있는지 확인해 주세요. 결과는 운영진방에 올라갑니다.");
    setRunLog(done?.result ?? "");
    await refresh();
  }

  async function showChanges() {
    setBusy(true);
    const result = await callBot({ action: "changes" });
    setBusy(false);
    if (!result.ok) return setNote(`❌ ${result.error ?? "불러오지 못했습니다."}`);
    setNote("");
    setChanges({ pending: result.pending ?? [], log: result.log ?? [], runs: result.runs ?? [] });
  }

  function create() {
    const name = (newName ?? "").trim();
    const file = name.endsWith(".py") ? name : `${name}.py`;
    if (!/^[A-Za-z0-9_-]+\.py$/.test(file)) return setNote("❌ 영문 · 숫자 · _ · - 로 된 이름만 쓸 수 있어요.");
    if ((rows ?? []).some((row) => row.name === file)) return setNote("❌ 같은 이름의 파일이 이미 있어요.");
    setNote("");
    setNewName(null);
    setTab("code");
    setFileLog([]);
    setEditing({ name: file, text: "", saved: "", live: null, crlf: false, updatedAt: null });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    const content = editing.crlf ? editing.text.replace(/\n/g, "\r\n") : editing.text;
    const result = await callBot({ action: "save", name: editing.name, content, expected: editing.updatedAt });
    setBusy(false);
    if (!result.ok) return setNote(`❌ ${result.error ?? "저장하지 못했습니다."}`);
    setEditing({ ...editing, saved: editing.text, updatedAt: result.updatedAt ?? editing.updatedAt });
    setNote("✅ 저장했어요. 목록의 '봇에 적용'을 누르면 봇에 반영됩니다.");
    await refresh();
  }

  async function change(action: "remove" | "revert", name: string, question: string) {
    if (!window.confirm(question)) return;
    setBusy(true);
    const result = await callBot({ action, name });
    setBusy(false);
    if (!result.ok) return setNote(`❌ ${result.error ?? "처리하지 못했습니다."}`);
    setEditing(null);
    setNote(action === "remove" ? `🗑️ ${name}: 봇에 적용할 때 지워집니다.` : `↩️ ${name}: 고친 내용을 취소했어요.`);
    await refresh();
  }

  function close() {
    if (editing) {
      if (dirty && !window.confirm("저장하지 않은 내용이 있어요. 닫을까요?")) return;
      setNote("");
      return setEditing(null);
    }
    if (changes) return setChanges(null);
    onClose();
  }

  const row = editing ? rows?.find((item) => item.name === editing.name) : undefined;

  return (
    <div className="botAdmin" role="dialog" aria-modal="true" aria-label="봇관리">
      <div className="botAdminHead">
        <strong>{editing ? editing.name : changes ? "📜 변경 내역" : "🤖 봇관리"}</strong>
        <button aria-label={editing || changes ? "목록으로" : "닫기"} onClick={close}>{editing || changes ? "←" : "×"}</button>
      </div>
      {note && <p className="botAdminNote">{note}</p>}

      {editing ? (
        <>
          <div className="botAdminTabs">
            <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>코드</button>
            <button className={tab === "diff" ? "on" : ""} onClick={() => void showFileDiff()}>변경 내역</button>
          </div>
          {tab === "code" ? (
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
            </>
          ) : (
            <div className="botAdminScroll">
              <div className="botAdminTitle">적용 대기 {dirty ? "(저장 전 포함)" : ""}</div>
              <DiffView diff={editingDiff} />
              <div className="botAdminTitle">지난 적용</div>
              {fileLog.length === 0 && <p className="botAdminHint">기록이 없어요.</p>}
              {fileLog.map((item) => <LogCard key={item.id} row={item} showName={false} />)}
            </div>
          )}
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
      ) : changes ? (
        <div className="botAdminScroll">
          <div className="botAdminTitle">실행 로그</div>
          {changes.runs.length === 0 && <p className="botAdminHint">기록이 없어요.</p>}
          {changes.runs.map((item) => <RunCard key={item.id} row={item} />)}
          <div className="botAdminTitle">적용 대기 {changes.pending.length}개</div>
          {changes.pending.length === 0 && <p className="botAdminHint">적용할 변경이 없어요.</p>}
          {changes.pending.map((script) => <PendingCard key={script.name} script={script} />)}
          <div className="botAdminTitle">최근 적용</div>
          {changes.log.length === 0 && <p className="botAdminHint">기록이 없어요.</p>}
          {changes.log.map((item) => <LogCard key={item.id} row={item} showName />)}
        </div>
      ) : (
        <>
          <div className="botAdminTools">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="파일 검색" autoComplete="off" aria-label="파일 검색" />
            <button className="smallButton ghost" disabled={busy} onClick={() => void showChanges()}>변경 내역</button>
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
          {pending > 0 && <p className="botAdminPending">📝 적용 대기 {pending}개</p>}
          {runLog && (
            <details className="botChange" open>
              <summary><b>🔍 실행 로그</b></summary>
              <pre className="botLog">{runLog}</pre>
            </details>
          )}
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
          <div className="botAdminActions">
            <button className="smallButton" disabled={busy || pending === 0} onClick={() => void run("apply")}>봇에 적용{pending > 0 ? ` (${pending})` : ""}</button>
            <button className="smallButton ghost" disabled={busy} onClick={() => void run("revert")}>되돌리기</button>
            <button className="smallButton ghost" disabled={busy} onClick={() => void run("upload")}>다시 올리기</button>
          </div>
          <p className="botAdminHint">저장만으로는 봇이 바뀌지 않아요. 운영진방 <b>!봇적용</b> · <b>!봇변경</b> · <b>!봇되돌리기</b> · <b>!봇올리기</b> 도 같습니다.</p>
        </>
      )}
    </div>
  );
}
