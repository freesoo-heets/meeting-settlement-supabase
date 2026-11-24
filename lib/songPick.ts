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
  durationMs: number | null;
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
  trackTimeMillis?: number;
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

type DeezerTrack = { id: number; duration?: number; title?: string; title_short?: string; preview?: string; release_date?: string;
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
  trackTimeMillis: t.duration ? t.duration * 1000 : undefined,
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

// ★ 시대별 히트곡 (가수, 제목, 연도) — 모두 아는 곡만. 시대 · 연도 주제는 여기서 고른다
type Hit = [string, string, number];
const HITS: Hit[] = [
  // 1990년대
  ["서태지와 아이들", "난 알아요", 1992], ["서태지와 아이들", "하여가", 1993], ["서태지와 아이들", "Come Back Home", 1995],
  ["김건모", "핑계", 1993], ["김건모", "잘못된 만남", 1995], ["김건모", "스피드", 1996], ["신승훈", "보이지 않는 사랑", 1991],
  ["015B", "아주 오래된 연인들", 1992], ["듀스", "나를 돌아봐", 1993], ["듀스", "여름 안에서", 1994], ["투투", "일과 이분의 일", 1994],
  ["노이즈", "상상속의 너", 1994], ["김광석", "사랑했지만", 1991], ["김광석", "서른 즈음에", 1994], ["이승환", "천일동안", 1995],
  ["룰라", "날개 잃은 천사", 1995], ["R.ef", "이별공식", 1995], ["김종서", "아름다운 구속", 1996], ["클론", "쿵따리 샤바라", 1996],
  ["H.O.T.", "캔디", 1996], ["H.O.T.", "전사의 후예", 1996], ["H.O.T.", "행복", 1997], ["H.O.T.", "빛", 1998],
  ["영턱스클럽", "정", 1996], ["자자", "버스 안에서", 1996], ["터보", "트위스트 킹", 1996], ["쿨", "애상", 1997], ["쿨", "해변의 여인", 1997],
  ["쿨", "운명", 1998], ["젝스키스", "폼생폼사", 1997], ["젝스키스", "커플", 1998], ["S.E.S.", "I'm Your Girl", 1997],
  ["S.E.S.", "Dreams Come True", 1998], ["DJ DOC", "DOC와 춤을", 1997], ["박진영", "그녀는 예뻤다", 1997], ["박진영", "허니", 1998],
  ["유승준", "가위", 1997], ["유승준", "나나나", 1998], ["엄정화", "포이즌", 1998], ["엄정화", "페스티벌", 1999], ["김현정", "그녀와의 이별", 1998],
  ["핑클", "내 남자친구에게", 1998], ["핑클", "영원한 사랑", 1999], ["조성모", "To Heaven", 1998], ["god", "어머님께", 1999],
  ["god", "촛불하나", 1999], ["신화", "T.O.P", 1999], ["이정현", "와", 1999], ["클론", "초련", 1999],
  // 2000년대
  ["god", "거짓말", 2000], ["god", "길", 2001], ["조성모", "아시나요", 2000], ["소찬휘", "Tears", 2000], ["이정현", "바꿔", 2000],
  ["DJ DOC", "Run To You", 2000], ["신승훈", "I Believe", 2001], ["보아", "No.1", 2002], ["보아", "아틀란티스 소녀", 2003],
  ["비", "나쁜 남자", 2002], ["비", "태양을 피하는 방법", 2003], ["휘성", "안되나요", 2002], ["김범수", "보고싶다", 2002],
  ["이효리", "10 Minutes", 2003], ["빅마마", "체념", 2003], ["거미", "친구라도 될 걸 그랬어", 2003], ["동방신기", "Hug", 2004],
  ["SG워너비", "Timeless", 2004], ["김종국", "한 남자", 2004], ["박효신", "눈의 꽃", 2004], ["이승기", "내 여자라니까", 2004],
  ["장윤정", "어머나", 2004], ["신화", "Brand New", 2004], ["버즈", "가시", 2005], ["버즈", "겁쟁이", 2005], ["김종국", "사랑스러워", 2005],
  ["에픽하이", "Fly", 2005], ["동방신기", "풍선", 2006], ["성시경", "거리에서", 2006], ["원더걸스", "Tell Me", 2007],
  ["빅뱅", "거짓말", 2007], ["빅뱅", "마지막 인사", 2007], ["소녀시대", "다시 만난 세계", 2007], ["SG워너비", "라라라", 2007],
  ["SG워너비", "내 사람", 2007], ["빅뱅", "하루하루", 2008], ["원더걸스", "So Hot", 2008], ["원더걸스", "Nobody", 2008],
  ["이효리", "U-Go-Girl", 2008], ["동방신기", "주문 - MIROTIC", 2008], ["손담비", "미쳤어", 2008], ["백지영", "총 맞은 것처럼", 2008],
  ["에픽하이", "우산", 2008], ["카라", "Pretty Girl", 2008], ["샤이니", "누난 너무 예뻐 (Replay)", 2008], ["소녀시대", "Gee", 2009],
  ["소녀시대", "소원을 말해봐", 2009], ["슈퍼주니어", "Sorry, Sorry", 2009], ["2NE1", "I Don't Care", 2009], ["2NE1", "Fire", 2009],
  ["카라", "미스터", 2009], ["브라운아이드걸스", "Abracadabra", 2009], ["이승기", "결혼해줄래", 2009], ["2PM", "Again & Again", 2009],
  ["티아라", "Bo Peep Bo Peep", 2009], ["샤이니", "Ring Ding Dong", 2009], ["다비치", "8282", 2009],
  // 2010년대
  ["아이유", "좋은 날", 2010], ["미쓰에이", "Bad Girl Good Girl", 2010], ["소녀시대", "Oh!", 2010], ["소녀시대", "훗", 2010],
  ["샤이니", "Lucifer", 2010], ["아이유", "너랑 나", 2011], ["2NE1", "내가 제일 잘 나가", 2011], ["현아", "Bubble Pop!", 2011],
  ["싸이", "강남스타일", 2012], ["빅뱅", "FANTASTIC BABY", 2012], ["버스커버스커", "벚꽃 엔딩", 2012], ["버스커버스커", "여수 밤바다", 2012],
  ["씨스타", "나 혼자", 2012], ["소녀시대", "I GOT A BOY", 2013], ["엑소", "으르렁", 2013], ["에일리", "보여줄게", 2013],
  ["에이핑크", "NoNoNo", 2013], ["씨스타", "Touch My Body", 2014], ["에이핑크", "Mr. Chu", 2014], ["걸스데이", "Something", 2014],
  ["자이언티", "양화대교", 2014], ["박효신", "야생화", 2014], ["악동뮤지션", "200%", 2014], ["빅뱅", "BANG BANG BANG", 2015],
  ["마마무", "음오아예", 2015], ["여자친구", "오늘부터 우리는", 2015], ["트와이스", "OOH-AHH하게", 2015], ["태연", "I", 2015],
  ["임창정", "내가 저지른 사랑", 2015], ["샤이니", "View", 2015], ["트와이스", "CHEER UP", 2016], ["트와이스", "TT", 2016],
  ["방탄소년단", "피 땀 눈물", 2016], ["블랙핑크", "휘파람", 2016], ["볼빨간사춘기", "우주를 줄게", 2016], ["여자친구", "시간을 달려서", 2016],
  ["레드벨벳", "Russian Roulette", 2016], ["10CM", "봄이 좋냐??", 2016], ["방탄소년단", "봄날", 2017], ["방탄소년단", "DNA", 2017],
  ["아이유", "밤편지", 2017], ["아이유", "팔레트", 2017], ["레드벨벳", "빨간 맛", 2017], ["워너원", "에너제틱", 2017], ["선미", "가시나", 2017],
  ["위너", "REALLY REALLY", 2017], ["마마무", "별이 빛나는 밤", 2017], ["멜로망스", "선물", 2017], ["브레이브걸스", "롤린", 2017],
  ["DAY6", "예뻤어", 2017], ["방탄소년단", "IDOL", 2018], ["블랙핑크", "뚜두뚜두", 2018], ["트와이스", "What is Love?", 2018],
  ["아이콘", "사랑을 했다", 2018], ["폴킴", "모든 날, 모든 순간", 2018], ["볼빨간사춘기", "여행", 2018], ["엑소", "Love Shot", 2018],
  ["방탄소년단", "작은 것들을 위한 시", 2019], ["블랙핑크", "Kill This Love", 2019], ["아이유", "Blueming", 2019], ["청하", "벌써 12시", 2019],
  ["악동뮤지션", "어떻게 이별까지 사랑하겠어, 널 사랑하는 거지", 2019], ["잔나비", "주저하는 연인들을 위해", 2019],
  ["장범준", "흔들리는 꽃들 속에서 네 샴푸향이 느껴진거야", 2019], ["DAY6", "한 페이지가 될 수 있게", 2019],
  // 2020년대
  ["지코", "아무노래", 2020], ["방탄소년단", "Dynamite", 2020], ["블랙핑크", "How You Like That", 2020], ["임영웅", "이제 나만 믿어요", 2020],
  ["싹쓰리", "다시 여기 바닷가", 2020], ["환불원정대", "DON'T TOUCH ME", 2020], ["아이유", "라일락", 2021], ["아이유", "Celebrity", 2021],
  ["아이유", "strawberry moon", 2021], ["방탄소년단", "Butter", 2021], ["에스파", "Next Level", 2021], ["아이브", "ELEVEN", 2021],
  ["이무진", "신호등", 2021], ["임영웅", "사랑은 늘 도망가", 2021], ["아이브", "LOVE DIVE", 2022], ["아이브", "After LIKE", 2022],
  ["뉴진스", "Attention", 2022], ["뉴진스", "Hype Boy", 2022], ["뉴진스", "Ditto", 2022], ["르세라핌", "ANTIFRAGILE", 2022],
  ["르세라핌", "FEARLESS", 2022], ["(여자)아이들", "TOMBOY", 2022], ["블랙핑크", "Pink Venom", 2022], ["윤하", "사건의 지평선", 2022],
  ["경서", "나의 X에게", 2022], ["태연", "INVU", 2022], ["멜로망스", "사랑인가 봐", 2022], ["뉴진스", "OMG", 2023], ["뉴진스", "Super Shy", 2023],
  ["아이브", "I AM", 2023], ["(여자)아이들", "Queencard", 2023], ["에스파", "Spicy", 2023], ["세븐틴", "손오공", 2023], ["정국", "Seven", 2023],
  ["비비", "밤양갱", 2024], ["에스파", "Supernova", 2024], ["에스파", "Whiplash", 2024], ["아일릿", "Magnetic", 2024], ["로제", "APT.", 2024],
  ["QWER", "고민중독", 2024], ["아이유", "Love wins all", 2024], ["지민", "Who", 2024],
];

// 히트곡 하나를 애플에서 찾는다 (제목이 맞는 첫 곡 · 가수까지 맞으면 우선)
async function findHit([artist, title]: Hit): Promise<(Raw & { art?: string }) | null> {
  const want = norm(cleanTitle(title).replace(/\(.*?\)/g, ""));
  const who = norm(artist);
  let best: { s: Raw; score: number } | null = null;
  for (const s of await search(`${artist} ${title}`, 15)) {
    if (!s.previewUrl || !s.trackName || NOT_SONG.test(s.trackName) || /remix|ver\.|version|live|라이브|sped|acoustic/i.test(s.trackName)) continue;
    const got = norm(cleanTitle(s.trackName).replace(/\(.*?\)/g, ""));
    if (!got || !(got === want || got.includes(want) || want.includes(got))) continue;
    const by = norm(s.artistName ?? "");
    const score = (got === want ? 2 : 0) + (by.includes(who) || who.includes(by) ? 2 : 0);
    if (!best || score > best.score) best = { s, score };
    if (score >= 4) break;
  }
  return best?.s ?? null;
}

async function hitPool(start: number, end: number, want: number) {
  // 한 해만 고르면 곡이 적으니, 3곡이 안 되면 앞뒤로 넓힌다
  let range = HITS.filter(([, , y]) => y >= start && y <= end);
  for (let pad = 1; range.length < 3 && pad <= 3; pad += 1) range = HITS.filter(([, , y]) => y >= start - pad && y <= end + pad);
  const out: Array<Raw & { art?: string }> = [];
  for (const hit of shuffle(range).slice(0, want + 3)) {
    const found = await findHit(hit);
    if (found) out.push(found);
    if (out.length >= want + 2) break; // 최근에 낸 곡이 섞여도 고를 수 있게 조금 더
  }
  return out;
}

async function poolFor(topic: string, want: number): Promise<Array<Raw & { art?: string }>> {
  const era = topic ? parseEra(topic) : null;
  if (era) {
    // ★ 11-24: 그 시대 가수의 아무 곡(수록곡 포함)이 나와 너무 어렵다 → 모두 아는 히트곡 목록에서만 낸다
    const hits = await hitPool(era[0], era[1], want);
    if (hits.length >= want) return hits;
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
    // ★ 11-24: 가수 이름은 검색 결과 위쪽(인기 · 관련도 순) 곡만 — 아래쪽은 잘 모르는 수록곡이 많다
    let pool: Array<Raw & { art?: string }> = (await search(topic, 50)).slice(0, 20);
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
  // 최근에 낸 곡은 빼고 고르되, 모자라면(히트곡 목록이 짧은 시대 등) 최근 곡도 다시 낸다
  const shuffled = shuffle(pool);
  for (const s of [...shuffled.filter((x) => !recentIds.has(String(x.trackId ?? ""))), ...shuffled]) {
    if (picked.length >= count) break;
    if (s.wrapperType && s.wrapperType !== "track") continue;
    const trackId = String(s.trackId ?? "");
    if (!s.previewUrl || !s.trackName || !trackId || picked.some((p) => p.trackId === trackId) || NOT_SONG.test(s.trackName)) continue;
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
      durationMs: s.trackTimeMillis ?? null,
    });
  }
  return picked;
}
