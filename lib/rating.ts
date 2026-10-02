// 오목·알까기 Elo 레이팅 (서버·화면 공용)
// 저장하지 않고, 끝난 대국 기록을 끝난 순서대로 처음부터 다시 계산한다.

export const RATING_START = 1000;
export const RATING_K = 32;
export const PLACEMENT_GAMES = 10; // 이 판 수 전까지는 변동폭 2배 (배치 기간)

export type RatedGame = {
  id: string;
  host_member: string;
  guest_member: string;
  winner: "host" | "guest" | "draw";
  finished_at: string;
};

export type RatingRow = {
  memberId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  recent: Array<"W" | "L" | "D">; // 최근 5판, 최신이 앞
  placement: boolean;
};

export type RatingChange = { host: number; guest: number; hostAfter: number; guestAfter: number };

function expected(a: number, b: number) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function computeRatings(games: RatedGame[]) {
  const sorted = [...games].sort((a, b) => a.finished_at.localeCompare(b.finished_at));
  const table = new Map<string, RatingRow & { exact: number }>();
  const changes: Record<string, RatingChange> = {};

  const get = (memberId: string) => {
    let row = table.get(memberId);
    if (!row) {
      row = { memberId, rating: RATING_START, exact: RATING_START, games: 0, wins: 0, losses: 0, draws: 0, recent: [], placement: true };
      table.set(memberId, row);
    }
    return row;
  };

  for (const game of sorted) {
    if (game.host_member === game.guest_member) continue;
    const host = get(game.host_member);
    const guest = get(game.guest_member);
    const scoreHost = game.winner === "host" ? 1 : game.winner === "guest" ? 0 : 0.5;
    const expHost = expected(host.exact, guest.exact);
    const kHost = host.games < PLACEMENT_GAMES ? RATING_K * 2 : RATING_K;
    const kGuest = guest.games < PLACEMENT_GAMES ? RATING_K * 2 : RATING_K;
    const beforeHost = Math.round(host.exact);
    const beforeGuest = Math.round(guest.exact);
    host.exact += kHost * (scoreHost - expHost);
    guest.exact += kGuest * (1 - scoreHost - (1 - expHost));

    for (const [row, score] of [[host, scoreHost], [guest, 1 - scoreHost]] as const) {
      row.games += 1;
      const mark: "W" | "L" | "D" = score === 1 ? "W" : score === 0 ? "L" : "D";
      if (mark === "W") row.wins += 1;
      else if (mark === "L") row.losses += 1;
      else row.draws += 1;
      row.recent = [mark, ...row.recent].slice(0, 5);
      row.rating = Math.round(row.exact);
      row.placement = row.games < PLACEMENT_GAMES;
    }
    changes[game.id] = {
      host: host.rating - beforeHost,
      guest: guest.rating - beforeGuest,
      hostAfter: host.rating,
      guestAfter: guest.rating,
    };
  }

  const rows: RatingRow[] = [...table.values()]
    .map(({ exact: _exact, ...row }) => row)
    .sort((a, b) => b.rating - a.rating || b.games - a.games);
  return { rows, changes };
}
