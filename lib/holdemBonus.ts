import { bestHand, cardText, type Card, type Table } from "./holdem";

// 🃏 족보 보너스 (2026-11-26 사용자 요청) — 높은 족보로 판을 이기면 카톡 점수판에 보너스
//   · 쇼다운에서 이긴 사람만 (모두 폴드로 이긴 판은 족보를 겨루지 않았으므로 없음)
//   · 내 카드(손패)가 족보에 들어가야 한다 (바닥 5장만으로 된 족보는 모두가 같으니 없음)
//   · 나눠 이긴(무승부) 사람도 각자 받는다
//   · 친선 · 시험 테이블은 없음 (점수가 걸리지 않는 판)
export const HAND_BONUS = { royal: 1000, straightFlush: 700, fourOfAKind: 500 };

export type HandBonus = { playerId: number; hand: string; points: number; cards: string };

const same = (a: Card, b: Card) => a.r === b.r && a.s === b.s;

export function handBonuses(t: Table): HandBonus[] {
  if (t.stage !== "showdown" || t.handNo <= 0 || t.board.length < 5) return [];
  const out: HandBonus[] = [];
  for (const w of t.winners) {
    if (w.hand === "모두 폴드" || w.amount <= 0) continue;
    const p = t.players[w.id];
    if (!p || p.empty || p.hole.length !== 2) continue;
    const best = bestHand([...p.hole, ...t.board]);
    const [kind, high] = best.score;
    let hand = "";
    let points = 0;
    if (kind === 8) {
      if (!best.cards.some((c) => p.hole.some((h) => same(c, h)))) continue;
      hand = high === 14 ? "로얄 스트레이트 플러시" : "스트레이트 플러시";
      points = high === 14 ? HAND_BONUS.royal : HAND_BONUS.straightFlush;
    } else if (kind === 7) {
      if (!p.hole.some((h) => h.r === high)) continue; // 포카드 숫자를 내 카드로 하나 이상 들고 있어야
      hand = "포카드";
      points = HAND_BONUS.fourOfAKind;
    } else continue;
    const shown = [...best.cards].sort((a, b) => b.r - a.r);
    out.push({ playerId: p.id, hand, points, cards: shown.map(cardText).join(" ") });
  }
  return out;
}
