"use client";

import { useCallback, useEffect, useState } from "react";
import { WORD_LEN, splitWord } from "../lib/wordGame";
import { waitWordEdit, type WordEdit } from "./WordGame";

// 🛠 단어 관리 (관리자): 단어 검색 · 추가 · 삭제 · 애매한 삭제 요청 정하기. 단어장은 봇이 고친다

type DictRow = { word: string; valid: boolean | null; reason: string | null };
type EditRow = { id: string; word: string; action: string; source: string; name: string; state: string; result: string | null; reason: string | null };
type Result = { ok: boolean; error?: string; id?: string; edit?: WordEdit; rows?: DictRow[]; asks?: EditRow[]; recent?: EditRow[] };

type Props = {
  call: (payload: Record<string, unknown>) => Promise<Result>;
  onClose: () => void;
};

const VALID_LABEL = (valid: boolean | null) => (valid === null ? "AI 확인 중" : valid ? "사용 중" : "제외됨");
const RESULT_LABEL: Record<string, string> = { added: "추가", deleted: "삭제", kept: "유지" };

function editLabel(row: EditRow) {
  if (row.state === "requested") return "처리 대기";
  if (row.state === "failed") return "실패";
  return RESULT_LABEL[row.result ?? ""] ?? "-";
}

export default function WordDictAdmin({ call, onClose }: Props) {
  const [text, setText] = useState("");
  const [searched, setSearched] = useState("");
  const [rows, setRows] = useState<DictRow[]>([]);
  const [asks, setAsks] = useState<EditRow[]>([]);
  const [recent, setRecent] = useState<EditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async (word: string) => {
    const result = await call({ action: "dictSearch", word });
    if (!result.ok) return setNote(`❌ ${result.error ?? "불러오지 못했습니다."}`);
    setRows(result.rows ?? []);
    setAsks(result.asks ?? []);
    setRecent(result.recent ?? []);
    setSearched(word);
  }, [call]);

  useEffect(() => {
    void refresh("");
  }, [refresh]);

  async function edit(payload: Record<string, unknown>, word: string, doneText: string) {
    setBusy(true);
    setNote(`⏳ '${word}' 처리 중…`);
    const result = await call(payload);
    if (!result.ok) {
      setBusy(false);
      setNote(`❌ ${result.error ?? "처리하지 못했습니다."}`);
      return;
    }
    const done = result.id ? await waitWordEdit(result.id, call) : null;
    if (result.id && !done) setNote("⏳ 봇이 아직 처리하지 못했어요. 봇이 켜지면 자동으로 처리됩니다.");
    else if (done?.state === "failed") setNote(`❌ ${done.reason ?? "처리하지 못했습니다."}`);
    else setNote(doneText);
    setBusy(false);
    await refresh(searched);
  }

  const word = text.trim();
  const jamoCount = splitWord(word).length;
  const isHangul = /^[가-힣]{1,5}$/.test(word);
  const unknown = isHangul && searched === word && !rows.some((row) => row.word === word);

  return (
    <div className="wdResultBack" onClick={onClose}>
      <div className="wdDict" role="dialog" aria-modal="true" aria-label="단어 관리" onClick={(e) => e.stopPropagation()}>
        <div className="wdDictHead">
          <strong>🛠 단어 관리</strong>
          <button aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <form
          className="wdDictSearch"
          onSubmit={(event) => {
            event.preventDefault();
            setNote(isHangul ? "" : "한글 단어를 입력해 주세요.");
            if (isHangul) void refresh(word);
          }}
        >
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="단어 검색" maxLength={5} autoComplete="off" aria-label="단어 검색" />
          <button type="submit">검색</button>
        </form>
        {note && <p className="wdDictNote">{note}</p>}

        {(rows.length > 0 || unknown) && (
          <div className="wdDictList">
            {rows.map((row) => (
              <div className="wdDictRow" key={row.word}>
                <b>{row.word}</b>
                <span>{VALID_LABEL(row.valid)}</span>
                {row.valid ? (
                  <button className="del" disabled={busy} onClick={() => void edit({ action: "dictEdit", op: "delete", word: row.word }, row.word, `🗑️ '${row.word}' 삭제했어요.`)}>삭제</button>
                ) : (
                  <button disabled={busy || splitWord(row.word).length !== WORD_LEN} onClick={() => void edit({ action: "dictEdit", op: "add", word: row.word }, row.word, `✅ '${row.word}' 추가했어요.`)}>추가</button>
                )}
              </div>
            ))}
            {unknown && (
              <div className="wdDictRow">
                <b>{word}</b>
                <span>{jamoCount === WORD_LEN ? "단어장에 없음" : `풀어서 ${jamoCount}자리 · ${WORD_LEN}자리만 추가 가능`}</span>
                <button disabled={busy || jamoCount !== WORD_LEN} onClick={() => void edit({ action: "dictEdit", op: "add", word }, word, `✅ '${word}' 추가했어요.`)}>추가</button>
              </div>
            )}
          </div>
        )}

        {asks.length > 0 && (
          <>
            <div className="wdDictTitle">🤔 운영진 확인이 필요한 삭제 요청</div>
            <div className="wdDictList">
              {asks.map((row) => (
                <div className="wdDictRow" key={row.id}>
                  <b>{row.word}</b>
                  <span>{row.name}{row.reason ? ` · ${row.reason}` : ""}</span>
                  <button className="del" disabled={busy} onClick={() => void edit({ action: "dictDecide", word: row.word }, row.word, `🗑️ '${row.word}' 삭제했어요.`)}>삭제</button>
                  <button disabled={busy} onClick={() => void edit({ action: "dictDecide", word: row.word, keep: true }, row.word, `✅ '${row.word}' 유지해요.`)}>유지</button>
                </div>
              ))}
            </div>
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="wdDictTitle">최근 처리</div>
            <div className="wdDictList">
              {recent.map((row) => (
                <div className="wdDictRow" key={row.id}>
                  <b>{row.word}</b>
                  <span>{editLabel(row)} · {row.name}{row.source === "kakao" ? " (카톡)" : ""}{row.reason ? ` · ${row.reason}` : ""}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
