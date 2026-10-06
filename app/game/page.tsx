import type { Metadata } from "next";
import { getServerAdmin } from "../../lib/server-admin";

// 게임 초대 링크 전용 주소 (/game?omok=… · /game?alkkagi=… · /game?catch=…)
// 카톡 미리보기에 '모임 참석 · 비용 정산' 대신 게임 제목이 나오게 하고, 들어오면 메인 화면의 그 방으로 보낸다.

type Kind = "omok" | "alkkagi" | "catch";
type Search = Promise<Record<string, string | string[] | undefined>>;

const LABEL: Record<Kind, string> = { omok: "🏁 오목", alkkagi: "🥏 알까기", catch: "🎨 캐치마인드" };

function pick(params: Record<string, string | string[] | undefined>): { kind: Kind; id: string } | null {
  for (const kind of ["omok", "alkkagi", "catch"] as Kind[]) {
    const value = params[kind];
    const id = Array.isArray(value) ? value[0] : value;
    if (id && /^[0-9a-f-]{36}$/i.test(id)) return { kind, id };
  }
  return null;
}

async function describe(kind: Kind, id: string) {
  try {
    const admin = getServerAdmin();
    if (kind === "catch") {
      const { data } = await admin.from("catch_rooms").select("host_name,players,max_players").eq("id", id).maybeSingle();
      if (!data) return null;
      const count = Array.isArray(data.players) ? data.players.length : 0;
      return {
        title: `${LABEL.catch} · ${data.host_name}님의 방`,
        description: `그림 맞히기 · ${count}/${data.max_players}명 · 눌러서 참가하세요`,
      };
    }
    const table = kind === "omok" ? "omok_games" : "alkkagi_games";
    const { data } = await admin.from(table).select("host_name,stake,is_friendly,target_member").eq("id", id).maybeSingle();
    if (!data) return null;
    const stake = data.is_friendly ? "🤝 친선전" : `💎 판돈 ${Number(data.stake).toLocaleString("ko-KR")}점`;
    return {
      title: `${LABEL[kind]} · ${data.host_name}님의 대국 신청`,
      description: `${stake} · 눌러서 대국에 참여하세요`,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const target = pick(await searchParams);
  const info = target ? await describe(target.kind, target.id) : null;
  const title = info?.title ?? (target ? `${LABEL[target.kind]} 같이 해요!` : "🎮 강서찐친 게임");
  const description = info?.description ?? "눌러서 게임에 참여하세요";
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function GameInvitePage({ searchParams }: { searchParams: Search }) {
  const target = pick(await searchParams);
  const next = target ? `/?${target.kind}=${target.id}` : "/";
  return (
    <main style={{ padding: "48px 16px", textAlign: "center", fontSize: 15 }}>
      <p>🎮 게임으로 이동하는 중…</p>
      <p>
        <a href={next}>바로 가기</a>
      </p>
      <script dangerouslySetInnerHTML={{ __html: `location.replace(${JSON.stringify(next)});` }} />
    </main>
  );
}
