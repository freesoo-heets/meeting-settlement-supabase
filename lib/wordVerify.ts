import type { getServerAdmin } from "./server-admin";

// 🤖 새 단어 AI 검증 — 사이트가 바로 묻는다. 기준은 봇 wordle_helper.py verify_word_with_gemini 와 같다 (같이 고친다)
//  · 결과는 word_dict 에 넣고, 봇은 10분마다 단어장 맞춤으로 받아 간다
//  · GEMINI_API_KEY 가 없거나 AI 오류면 valid=null 로 넣어 봇에게 넘긴다

const MODEL_NAME = "gemini-2.5-flash-lite";
const AI_TIMEOUT_MS = 8000;
const PENDING_MAX = 30; // 봇에게 넘긴 단어가 이보다 많으면 잠시 막는다

const SYSTEM =
  "당신은 엄격한 한국어 어휘 전문가입니다. 비속어나 성적인 단어는 절대 허용하지 않으며, 일반 성인이 일상에서 통상적으로 쓰는 건전한 표준어 명사만 true로 인정합니다. 사전에 있어도 잘 쓰이지 않는 단어는 false입니다.";

const prompt = (word: string) => `Task: Evaluate the Korean word '${word}'.

CRITICAL RULES:
1. It must be a real, standard Korean noun registered in the dictionary. Everyday loanwords (커피, 버스) are fine.
2. An average Korean adult must know it and use or hear it in everyday life. Reject words that exist only in the dictionary: archaic, obscure, academic, technical, dialect or rarely used words.
3. It MUST NOT be slang, profanity, offensive, or sexual in nature, and MUST NOT be a proper noun, an abbreviation, or a conjugated form.
4. If you are not sure that it is commonly used, it is invalid.

If ALL rules are met, set "is_valid" to true. Otherwise, set to false.
Provide a very brief reason in Korean for "reason".

Output ONLY valid JSON.
Format: {"is_valid": true, "reason": "이유"}`;

type Verdict = { word: string; valid: boolean; reason: string };
type Admin = ReturnType<typeof getServerAdmin>;

export async function verifyWord(word: string): Promise<Verdict | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt(word) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = JSON.parse(data.candidates[0].content.parts[0].text.replace(/```(json)?/gi, "").trim());
    if (typeof answer?.is_valid !== "boolean") return null;
    return { word, valid: answer.is_valid, reason: String(answer.reason ?? "").slice(0, 200) };
  } catch {
    return null;
  }
}

// 단어장에 쓸 수 있는 후보가 없을 때: 모르는 후보를 검증해 ok(쓸 수 있음) · refused(전부 부적합) · pending(봇이 검증 중) · busy(대기 초과)
export async function checkNewWords(
  admin: Admin,
  jamo: string,
  words: string[],
  rows: Array<{ word: string; valid: boolean | null }>,
): Promise<"ok" | "refused" | "pending" | "busy"> {
  const unknown = words.filter((word) => !rows.some((r) => r.word === word && r.valid !== null));
  const verdicts = (await Promise.all(unknown.map(verifyWord))).filter((v): v is Verdict => v !== null);
  if (verdicts.length) {
    await admin.from("word_dict").upsert(
      verdicts.map((v) => ({ word: v.word, jamo, valid: v.valid, reason: v.reason, updated_at: new Date().toISOString() })),
      { onConflict: "word" },
    );
  }
  if (verdicts.some((v) => v.valid)) return "ok";
  const left = unknown.filter((word) => !verdicts.some((v) => v.word === word));
  if (!left.length) return "refused";
  const fresh = left.filter((word) => !rows.some((r) => r.word === word));
  if (fresh.length) {
    const { count } = await admin.from("word_dict").select("word", { count: "exact", head: true }).is("valid", null);
    if ((count ?? 0) >= PENDING_MAX) return "busy";
    await admin.from("word_dict").upsert(
      fresh.map((word) => ({ word, jamo, valid: null })),
      { onConflict: "word", ignoreDuplicates: true },
    );
  }
  return "pending";
}
