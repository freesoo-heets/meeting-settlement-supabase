// 단어게임 — 카톡 봇 wordle_helper.py 와 같은 규칙
//  · 단어를 자모로 '끝까지' 풀어 쓴다 (ㄲ → ㄱㄱ, ㅘ → ㅗㅏ, ㄺ → ㄹㄱ). 풀어서 5자리인 단어만 쓴다
//  · 5번 안에 맞히기. 🟢 g 자리까지 맞음 · ⭐ y 들어 있지만 자리 다름 · ⬜ x 없음

export const WORD_LEN = 5;
export const MAX_TRIES = 5;
export const REWARDS: Record<number, number> = { 1: 300, 2: 150, 3: 90, 4: 50, 5: 30 };
export const TICKET_PRICE = 50; // 티켓이 없으면 이만큼 점수로 자동 구매

export type Mark = "g" | "y" | "x";

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const DOUBLE_CHO: Record<string, string[]> = { ㄲ: ["ㄱ", "ㄱ"], ㄸ: ["ㄷ", "ㄷ"], ㅃ: ["ㅂ", "ㅂ"], ㅆ: ["ㅅ", "ㅅ"], ㅉ: ["ㅈ", "ㅈ"] };
const COMPLEX_VOWELS: Record<string, string[]> = {
  ㅐ: ["ㅏ", "ㅣ"], ㅒ: ["ㅑ", "ㅣ"], ㅔ: ["ㅓ", "ㅣ"], ㅖ: ["ㅕ", "ㅣ"], ㅘ: ["ㅗ", "ㅏ"], ㅙ: ["ㅗ", "ㅏ", "ㅣ"],
  ㅚ: ["ㅗ", "ㅣ"], ㅝ: ["ㅜ", "ㅓ"], ㅞ: ["ㅜ", "ㅓ", "ㅣ"], ㅟ: ["ㅜ", "ㅣ"], ㅢ: ["ㅡ", "ㅣ"],
};
const DOUBLE_JONG: Record<string, string[]> = {
  ㄲ: ["ㄱ", "ㄱ"], ㄳ: ["ㄱ", "ㅅ"], ㄵ: ["ㄴ", "ㅈ"], ㄶ: ["ㄴ", "ㅎ"], ㄺ: ["ㄹ", "ㄱ"], ㄻ: ["ㄹ", "ㅁ"], ㄼ: ["ㄹ", "ㅂ"],
  ㄽ: ["ㄹ", "ㅅ"], ㄾ: ["ㄹ", "ㅌ"], ㄿ: ["ㄹ", "ㅍ"], ㅀ: ["ㄹ", "ㅎ"], ㅄ: ["ㅂ", "ㅅ"], ㅆ: ["ㅅ", "ㅅ"],
};

// 화면 자판 (스크린샷과 같은 배열). 풀어 쓰기 때문에 ㅐ ㅔ ㄲ 같은 글자는 없다
export const KEY_ROWS = [
  ["ㅂ", "ㅈ", "ㄷ", "ㄱ", "ㅅ", "ㅛ", "ㅕ", "ㅑ"],
  ["ㅁ", "ㄴ", "ㅇ", "ㄹ", "ㅎ", "ㅗ", "ㅓ", "ㅏ", "ㅣ"],
  ["ㅋ", "ㅌ", "ㅊ", "ㅍ", "ㅠ", "ㅜ", "ㅡ"],
];
export const KEYS = new Set(KEY_ROWS.flat());
const VOWELS = new Set(["ㅛ", "ㅕ", "ㅑ", "ㅗ", "ㅓ", "ㅏ", "ㅣ", "ㅠ", "ㅜ", "ㅡ"]);

// 컴퓨터 자판(두벌식 자리) → 자모
export const QWERTY: Record<string, string> = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
};

export function splitWord(word: string): string[] {
  const out: string[] = [];
  for (const ch of word) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      out.push(ch);
      continue;
    }
    const cho = CHO[Math.floor(code / 588)];
    const jung = JUNG[Math.floor((code % 588) / 28)];
    const jong = JONG[code % 28];
    out.push(...(DOUBLE_CHO[cho] ?? [cho]), ...(COMPLEX_VOWELS[jung] ?? [jung]));
    if (jong) out.push(...(DOUBLE_JONG[jong] ?? [jong]));
  }
  return out;
}

export function checkGuess(target: string[], guess: string[]): Mark[] {
  const result: Mark[] = guess.map(() => "x");
  const used = target.map(() => false);
  guess.forEach((j, i) => {
    if (target[i] === j) {
      result[i] = "g";
      used[i] = true;
    }
  });
  guess.forEach((j, i) => {
    if (result[i] === "g") return;
    const k = target.findIndex((t, n) => !used[n] && t === j);
    if (k >= 0) {
      result[i] = "y";
      used[k] = true;
    }
  });
  return result;
}

// 풀어 쓴 자모 → 만들 수 있는 낱말 모두 (예: ㄱㅏㄱㄱㅏ → 각가 · 가까)
const match = (table: Record<string, string[]>, jamo: string[], at: number) =>
  Object.entries(table).filter(([, parts]) => parts.every((p, n) => jamo[at + n] === p));

export function composeWords(jamo: string[]): string[] {
  const words = new Set<string>();
  const walk = (at: number, built: string) => {
    if (at === jamo.length) {
      if (built) words.add(built);
      return;
    }
    const inits: Array<[string, number]> = [];
    if (!VOWELS.has(jamo[at]) && CHO.includes(jamo[at])) inits.push([jamo[at], 1]);
    for (const [cho, parts] of match(DOUBLE_CHO, jamo, at)) inits.push([cho, parts.length]);
    for (const [cho, cl] of inits) {
      const vowels: Array<[string, number]> = [];
      const v = jamo[at + cl];
      if (v && VOWELS.has(v)) vowels.push([v, 1]);
      for (const [jung, parts] of match(COMPLEX_VOWELS, jamo, at + cl)) vowels.push([jung, parts.length]);
      for (const [jung, vl] of vowels) {
        const base = at + cl + vl;
        const finals: Array<[string, number]> = [["", 0]];
        const f = jamo[base];
        if (f && !VOWELS.has(f) && JONG.includes(f)) finals.push([f, 1]);
        for (const [jong, parts] of match(DOUBLE_JONG, jamo, base)) finals.push([jong, parts.length]);
        for (const [jong, fl] of finals) {
          const syllable = String.fromCharCode(0xac00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong));
          walk(base + fl, built + syllable);
        }
      }
    }
  };
  walk(0, "");
  return [...words];
}

export type WordGameRow = {
  id: string;
  member_id: string;
  name: string;
  status: "escrow" | "playing" | "won" | "lost" | "rejected";
  reject_reason: string | null;
  auto_bought: boolean;
  hint_len: number | null;
  history: Array<{ jamo: string[]; result: Mark[] }>;
  tries: number;
  max_tries: number;
  answer: string | null;
  reward: number;
  settle_state: string;
  created_at: string;
  finished_at: string | null;
};

export const WORD_GAME_COLUMNS =
  "id,member_id,name,status,reject_reason,auto_bought,hint_len,history,tries,max_tries,answer,reward,settle_state,created_at,finished_at";
