// 🎧 노래 맞추기 선곡 (서버 전용) — 카톡 봇 song_quiz_helper.pick_song 을 옮긴 것
//  · 기본: 애플 한국 인기차트의 K-POP → 모자라면 디저(Deezer) K-POP 가수 인기곡
//  · '팝송': 애플 미국 차트 → 디저 전 세계 차트 → 대표 가수 인기곡
//  · 시대(2010년대 · 90년대 · 2015 · 2010~2015): 그 시대 가수 곡을 검색해 발매연도로 거른다
//  · 그 밖의 말: 가수 · 곡 이름 검색
import { buildAnswers, cleanTitle, norm, parseEra } from "./songQuiz";

export type PickedSong = {
  trackId: string;
  title: string;
  artist: string;
  year: string;
  preview: string;
  artwork: string | null;
  answers: string[];
};

type Raw = {
  wrapperType?: string;
  trackId?: string | number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  previewUrl?: string;
  artworkUrl100?: string;
};

const SEED_TERMS = [
  "아이유", "BTS", "뉴진스", "아이브", "세븐틴", "임영웅", "볼빨간사춘기", "폴킴", "잔나비", "악동뮤지션", "태연", "에스파",
  "르세라핌", "블랙핑크", "빅뱅", "소녀시대", "성시경", "김범수", "이무진", "10cm", "데이식스", "윤하", "멜로망스", "박효신",
  "투모로우바이투게더", "NCT", "트와이스",
];

const SEED_BY_DECADE: Record<number, string[]> = {
  1990: ["김건모", "신승훈", "015B", "서태지와 아이들", "룰라", "쿨", "터보", "H.O.T.", "젝스키스", "S.E.S.", "핑클", "god", "김광석",
    "이승환", "조성모", "DJ DOC", "박진영", "엄정화", "코요태", "노이즈"],
  2000: ["보아", "동방신기", "SG워너비", "빅뱅", "원더걸스", "소녀시대", "이효리", "비", "버즈", "MC몽", "에픽하이", "휘성", "거미", "테이",
    "씨야", "슈퍼주니어", "카라", "2NE1", "김종국", "성시경", "박효신"],
  2010: ["아이유", "빅뱅", "소녀시대", "2NE1", "씨스타", "미쓰에이", "엑소", "방탄소년단", "트와이스", "레드벨벳", "블랙핑크", "볼빨간사춘기",
    "악동뮤지션", "버스커버스커", "에일리", "자이언티", "헤이즈", "폴킴", "멜로망스", "마마무", "여자친구", "워너원", "태연", "싸이"],
  2020: ["아이유", "뉴진스", "아이브", "르세라핌", "에스파", "임영웅", "세븐틴", "스트레이 키즈", "투모로우바이투게더", "방탄소년단", "이무진",
    "태연", "경서", "윤하", "데이식스", "잔나비", "로제", "지코", "(여자)아이들", "QWER"],
};

const POP_KEYWORDS = ["팝송", "팝", "pop", "해외", "외국노래", "외국", "빌보드"];
const POP_SEEDS = ["Taylor Swift", "Ed Sheeran", "Bruno Mars", "Ariana Grande", "The Weeknd", "Dua Lipa", "Justin Bieber",
  "Billie Eilish", "Maroon 5", "Coldplay", "Adele", "Charlie Puth", "Harry Styles", "Olivia Rodrigo", "Post Malone",
  "Sabrina Carpenter", "Imagine Dragons", "Lady Gaga", "Sia", "Shawn Mendes"];
const KPOP_GENRE_WORDS = ["k-pop", "kpop", "케이팝", "가요", "korean", "한국", "트로트"];
const REISSUE_EN = /\b(remaster(ed)?|best|greatest|hits|collection|anniversary|live)\b/i;
const REISSUE_KO = ["리마스터", "베스트", "기념", "라이브"];

export const isPopRequest = (keyword: string) => POP_KEYWORDS.includes(keyword.trim().toLowerCase());
export const eraSupported = (start: number, end: number) =>
  Object.keys(SEED_BY_DECADE).map(Number).some((d) => d <= end && d + 9 >= start);

const hasHangul = (text?: string) => /[가-힣]/.test(String(text ?? ""));
const isKpop = (s: Raw) =>
  KPOP_GENRE_WORDS.some((w) => String(s.primaryGenreName ?? "").toLowerCase().includes(w)) ||
  [s.trackName, s.artistName, s.collectionName].some(hasHangul);
// 노래가 아닌 트랙 (인트로 · 연주곡 · 반주 등)
const NOT_SONG = /\b(intro|outro|prologue|epilogue|interlude|skit|inst|instrumental|karaoke)\b|반주|연주곡|인트로/i;
const isReissue = (album?: string) => REISSUE_EN.test(String(album ?? "")) || REISSUE_KO.some((w) => String(album ?? "").includes(w));

function shuffle<T>(list: T[]) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) {
      console.log("[song] 응답", response.status, url.slice(0, 90));
      return null;
    }
    return await response.json();
  } catch (error) {
    console.log("[song] 조회 실패", url.slice(0, 90), String(error).slice(0, 80));
    return null;
  }
}

async function chartIds(country: "kr" | "us") {
  const data = (await getJson(`https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/100/songs.json`, 5000)) as
    | { feed?: { results?: Array<{ id: string }> } }
    | null;
  return (data?.feed?.results ?? []).map((item) => item.id);
}

async function lookup(ids: string[], country: "KR" | "US") {
  if (ids.length === 0) return [];
  const data = (await getJson(`https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}&entity=song`)) as
    | { results?: Raw[] }
    | null;
  return data?.results ?? [];
}

// ★ 2026-11: 애플 검색이 한국 스토어(country=KR)에서 늘 0곡을 준다 (한글 검색어도 미국 스토어는 된다).
//   그래서 미국 스토어로 찾은 뒤, 같은 곡 번호를 한국 스토어에서 다시 조회해 한글 제목으로 바꾼다 ('Red Umbrella' → '빨간우산')
async function search(term: string, limit = 50) {
  const query = (country: string) =>
    new URLSearchParams({ term, country, media: "music", entity: "song", limit: String(limit) });
  const us = ((await getJson(`https://itunes.apple.com/search?${query("US")}`)) as { results?: Raw[] } | null)?.results ?? [];
  const tracks = us.filter((s) => s.trackId && (!s.wrapperType || s.wrapperType === "track"));
  const korean = new Map<string, Raw>();
  for (let i = 0; i < tracks.length; i += 150) {
    for (const s of await lookup(tracks.slice(i, i + 150).map((s) => String(s.trackId)), "KR")) korean.set(String(s.trackId), s);
  }
  return tracks.map((s) => korean.get(String(s.trackId)) ?? s);
}

type DeezerTrack = { id: number; title?: string; title_short?: string; preview?: string; release_date?: string;
  artist?: { name?: string }; album?: { title?: string; cover_medium?: string } };

const fromDeezer = (t: DeezerTrack): Raw & { art?: string } => ({
  wrapperType: "track",
  trackId: `dz${t.id}`,
  trackName: t.title_short || t.title || "",
  artistName: t.artist?.name ?? "",
  collectionName: t.album?.title ?? "",
  primaryGenreName: "",
  releaseDate: String(t.release_date ?? ""),
  previewUrl: t.preview ?? "",
  art: t.album?.cover_medium,
});

async function deezer(path: string) {
  const data = (await getJson(`https://api.deezer.com${path}`)) as { data?: DeezerTrack[]; error?: unknown } | null;
  return data && !data.error ? data.data ?? [] : [];
}

async function deezerArtistTop(name: string, limit = 30) {
  const artists = (await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=1`)) as unknown as Array<{ id: number }>;
  if (!artists[0]) return [];
  return (await deezer(`/artist/${artists[0].id}/top?limit=${limit}`)).filter((t) => t.preview).map(fromDeezer);
}

async function poolFor(topic: string, want: number): Promise<Array<Raw & { art?: string }>> {
  const era = topic ? parseEra(topic) : null;
  if (era) {
    const [start, end] = era;
    const artists = shuffle([
      ...new Set(
        Object.entries(SEED_BY_DECADE)
          .filter(([d]) => Number(d) <= end && Number(d) + 9 >= start)
          .flatMap(([, list]) => list),
      ),
    ]);
    const pool: Raw[] = [];
    // 한 가수 곡만 나오지 않게 여러 가수를 찾는다 (애플 검색은 분당 약 20회 제한 · 가수당 2번 부름)
    const needArtists = Math.ceil(want / 2) + 1;
    let found = 0;
    for (const [i, artist] of artists.slice(0, 7).entries()) {
      if (i > 0) await sleep(300);
      let passed = 0;
      for (const s of await search(artist, 200)) {
        const year = String(s.releaseDate ?? "").slice(0, 4);
        if (!/^\d{4}$/.test(year) || Number(year) < start || Number(year) > end || isReissue(s.collectionName)) continue;
        pool.push(s);
        passed += 1;
      }
      if (passed > 0) found += 1;
      if (found >= needArtists && pool.length >= want * 3) break;
    }
    return pool;
  }
  if (isPopRequest(topic)) {
    let pool: Array<Raw & { art?: string }> = (await lookup(shuffle(await chartIds("us")).slice(0, 80), "US")).filter((s) => !isKpop(s));
    if (pool.length < want * 2) pool = pool.concat((await deezer("/chart/0/tracks?limit=100")).filter((t) => t.preview).map(fromDeezer).filter((s) => !isKpop(s)));
    if (pool.length < want * 2) pool = pool.concat((await deezerArtistTop(POP_SEEDS[Math.floor(Math.random() * POP_SEEDS.length)])).filter((s) => !isKpop(s)));
    return pool;
  }
  if (topic) {
    let pool: Array<Raw & { art?: string }> = await search(topic, 100);
    if (pool.length === 0) pool = await deezerArtistTop(topic, 50);
    if (pool.length === 0) pool = (await deezer(`/search?q=${encodeURIComponent(topic)}&limit=50`)).filter((t) => t.preview).map(fromDeezer);
    return pool;
  }
  let pool: Array<Raw & { art?: string }> = (await lookup(shuffle(await chartIds("kr")).slice(0, 100), "KR")).filter(isKpop);
  if (pool.length < want * 2) {
    for (const artist of shuffle(SEED_TERMS).slice(0, 3)) pool = pool.concat(await deezerArtistTop(artist));
  }
  return pool;
}

// 곡 여러 개 고르기 (최근에 낸 곡 · 같은 곡 다른 판은 빼고)
export async function pickSongs(topic: string, count: number, recentIds: Set<string>): Promise<PickedSong[]> {
  const pool = await poolFor(topic.trim(), count);
  // 가수 이름으로 고른 주제가 아니면 한 가수는 2곡까지
  const artistTopic = !!topic.trim() && !parseEra(topic) && !isPopRequest(topic);
  const perArtist = new Map<string, number>();
  const seen = new Set<string>();
  const picked: PickedSong[] = [];
  for (const s of shuffle(pool)) {
    if (picked.length >= count) break;
    if (s.wrapperType && s.wrapperType !== "track") continue;
    const trackId = String(s.trackId ?? "");
    if (!s.previewUrl || !s.trackName || !trackId || recentIds.has(trackId) || NOT_SONG.test(s.trackName)) continue;
    const artistKey = norm(s.artistName ?? "");
    if (!artistTopic && (perArtist.get(artistKey) ?? 0) >= 2) continue;
    const key = `${norm(cleanTitle(s.trackName))}|${norm(s.artistName ?? "")}`;
    if (seen.has(key)) continue;
    const answers = buildAnswers(s.trackName);
    if (answers.length === 0) continue;
    seen.add(key);
    perArtist.set(artistKey, (perArtist.get(artistKey) ?? 0) + 1);
    picked.push({
      trackId,
      title: s.trackName,
      artist: s.artistName ?? "",
      year: String(s.releaseDate ?? "").slice(0, 4),
      preview: s.previewUrl,
      artwork: s.art ?? (s.artworkUrl100 ? s.artworkUrl100.replace("100x100", "300x300") : null),
      answers,
    });
  }
  return picked;
}
