// 🎧 노래 맞추기 — 카톡 봇 song_quiz_helper.py 와 같은 규칙 (화면 · 서버 공용)
//  · 곡마다 2초 → 4초 → 6초 듣기 → 가수 힌트 → 제목 힌트, 단계가 지날수록 배점 x0.8 (30 · 24 · 19 · 15 · 12)
//  · 출제자가 곡당 티켓 1장 · 맞힌 사람은 카톡 점수판에 점수 (이용 시간 제한 없음)

export const TICKETS_PER_SONG = 1; // ★ 11-24 사용자 요청 2장 → 1장 (봇 song_quiz_helper.COST_TICKET 과 같게)
export const BASE_POINTS = 30;
export const HINT_DECAY = 0.8;
export const MAX_PLAYERS = 0; // 인원 제한 없음 (2026-11-24 사용자 요청 · 0 = 무제한)
export const SONG_COUNTS = [3, 5, 10];
export const CLIP_OFFSET = 1.0; // 미리듣기 앞쪽 페이드인 건너뛰기 (초)

// 단계: 들려주는 길이(초) · 단계 시간(초) · 공개할 힌트
export const STAGES: Array<{ clip: number; seconds: number; hint?: "artist" | "title"; label: string }> = [
  { clip: 2, seconds: 15, label: "🎵 2초 듣기" },
  { clip: 4, seconds: 15, label: "🎵 4초 듣기" },
  { clip: 6, seconds: 15, label: "🎵 6초 듣기" },
  { clip: 6, seconds: 20, hint: "artist", label: "💡 가수 힌트" },
  { clip: 6, seconds: 20, hint: "title", label: "💡 제목 힌트" },
];
export const INTRO_SECONDS = 4;
export const REVEAL_SECONDS = 9;

// 전주: 봇 폰이 원곡 앞부분을 잘라 올린다 · 하이라이트: 애플 미리듣기(후렴 근처)
export type SongMode = "highlight" | "intro";
export const MODES: Array<{ value: SongMode; label: string; desc: string }> = [
  { value: "highlight", label: "🎤 하이라이트", desc: "후렴 근처" },
  { value: "intro", label: "🎹 전주", desc: "곡 첫 부분" },
];

export const TOPIC_PRESETS = [
  { value: "", label: "🔥 K-POP 인기곡" },
  { value: "90년대", label: "📼 90년대" },
  { value: "2000년대", label: "💿 2000년대" },
  { value: "2010년대", label: "📱 2010년대" },
  { value: "2020년대", label: "🎧 2020년대" },
  { value: "팝송", label: "🌎 팝송" },
];

export function stagePoints(stage: number) {
  return Math.max(5, Math.floor(BASE_POINTS * HINT_DECAY ** stage));
}

export function topicLabel(topic: string) {
  const preset = TOPIC_PRESETS.find((item) => item.value === topic);
  if (preset) return preset.label;
  const era = parseEra(topic);
  return era ? `📅 ${era[2]}` : `🔎 ${topic}`;
}

const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

// 힌트용 가림: 한글 → 초성, 영문 → 첫 글자만, 숫자 → #
export function maskTitle(title: string) {
  return String(title)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      let latinSeen = false;
      return Array.from(word)
        .map((ch) => {
          const code = ch.charCodeAt(0) - 0xac00;
          if (code >= 0 && code <= 11171) return CHOSUNG[Math.floor(code / 588)];
          if (/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ一-鿿]/.test(ch)) {
            const out = latinSeen ? "_" : ch;
            latinSeen = true;
            return out;
          }
          if (/\d/.test(ch)) return "#";
          return ch;
        })
        .join("");
    })
    .join(" ");
}

// 비교용: 소문자 · 공백/특수문자 제거
export function norm(text: string) {
  return String(text).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

// 정답으로 인정할 형태들 ('좋은 날 (Good Day)' → 좋은날 · goodday · 좋은날goodday)
export function buildAnswers(title: string) {
  const answers = new Set<string>();
  answers.add(norm(title));
  let base = title.replace(/[([{].*?[)\]}]/g, "");
  base = base.split(/\s+-\s+|\s+feat\.?|\s+ft\.?/i)[0];
  answers.add(norm(base));
  // '주문 - MIROTIC' 처럼 ' - ' 로 나뉜 제목은 뒤쪽만 써도 정답
  for (const part of title.replace(/[([{].*?[)\]}]/g, "").split(/\s+-\s+/).slice(1)) {
    const n = norm(part);
    if (n.length >= 2) answers.add(n);
  }
  for (const match of title.matchAll(/[([](.*?)[)\]]/g)) {
    const inner = match[1];
    if (EXTRA_TAG.test(inner)) continue; // 리마스터 · 버전 · OST 같은 표기는 정답이 아니다
    const n = norm(inner);
    if (n.length >= 2) answers.add(n);
  }
  return [...answers].filter(Boolean);
}

// 초성 힌트용 제목 (괄호 안은 빼야 영문 병기로 정답이 드러나지 않는다)
export function hintTitle(title: string) {
  const t = String(title).replace(/\s*[([{].*?[)\]}]/g, "").split(/\s+-\s+/)[0];
  return t.trim() || String(title);
}

// 표시용 제목 (피처링 등 제거)
// 괄호 속 부가 표기 (피처링 · 리마스터 · 버전 · OST 등)
const EXTRA_TAG = /\bfeat|\bft\.|\bwith\b|\bprod\b|remix|\bver\b|\bver\.|version|\binst|remaster|\bedit\b|\bmix\b|\blive\b|\bfrom\b|\bost\b|o\.s\.t|sped up|acoustic|\b\d{4}\b/i;

export function cleanTitle(title: string) {
  return String(title)
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => (EXTRA_TAG.test(inner) ? "" : whole))
    .trim();
}

// 시대 표현 → [시작연도, 끝연도, 표시이름]
export function parseEra(text: string): [number, number, string] | null {
  const t = String(text ?? "").replace(/\s/g, "");
  const thisYear = new Date().getFullYear();
  let m = t.match(/^(\d{4})년대$/);
  if (m) {
    const y = Math.floor(Number(m[1]) / 10) * 10;
    return [y, Math.min(y + 9, thisYear), `${y}년대`];
  }
  m = t.match(/^(\d{2})년대$/);
  if (m) {
    const d = Number(m[1]);
    const y = Math.floor((d <= 30 ? 2000 + d : 1900 + d) / 10) * 10;
    return [y, Math.min(y + 9, thisYear), `${y}년대`];
  }
  m = t.match(/^(\d{4})년?[~-](\d{4})년?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
    return [a, b, `${a}~${b}년`];
  }
  m = t.match(/^(\d{4})년?$/);
  if (m) return [Number(m[1]), Number(m[1]), `${m[1]}년`];
  return null;
}
