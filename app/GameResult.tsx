"use client";

// 오목·알까기 종료 팝업 (화면 가운데에 결과 + 게임 종료 / 재경기 요청)

type Seat = "host" | "guest";

export type ResultGame = {
  host_name: string;
  guest_name: string | null;
  winner: Seat | "draw" | null;
  end_reason: string | null;
  stake: number;
  is_friendly?: boolean;
  is_test?: boolean;
};

export function GameResultPopup({
  game,
  mySeat,
  endText,
  busy,
  onClose,
  onRematch,
}: {
  game: ResultGame;
  mySeat: Seat | null;
  endText: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onRematch?: () => void;
}) {
  const nameOf = (seat: Seat | null) => (seat === "host" ? game.host_name : seat === "guest" ? game.guest_name ?? "?" : "?");
  const reason = endText[game.end_reason ?? ""] ?? "";
  const draw = game.winner === "draw";
  const won = !draw && mySeat !== null && game.winner === mySeat;
  const lost = !draw && mySeat !== null && game.winner !== mySeat;
  const noPoints = game.is_friendly || game.is_test;

  const tone = draw ? "draw" : won ? "win" : lost ? "lose" : "watch";
  const icon = draw ? "🤝" : won ? "🎉" : lost ? "😢" : "🏆";
  const title = draw ? "무승부" : won ? "승리!" : lost ? "패배" : `${nameOf(game.winner as Seat)} 승리`;
  const subtitle = draw
    ? `${game.host_name} · ${game.guest_name ?? "?"}`
    : `🏆 ${nameOf(game.winner as Seat)}${reason ? ` · ${reason}` : ""}`;
  const money = game.is_test
    ? "🧪 테스트 대국 · 점수 변동 없음"
    : noPoints
      ? "🤝 친선전 · 점수 변동 없음"
      : draw
        ? `판돈 ${game.stake.toLocaleString("ko-KR")}점 반환`
        : won
          ? `💎 +${game.stake.toLocaleString("ko-KR")}점`
          : lost
            ? `💎 -${game.stake.toLocaleString("ko-KR")}점`
            : `판돈 ${game.stake.toLocaleString("ko-KR")}점`;

  return (
    <div className="gameResultBackdrop" role="presentation">
      <div className={`gameResultCard ${tone}`} role="dialog" aria-modal="true" aria-label="대국 결과">
        <span className="gameResultIcon" aria-hidden="true">{icon}</span>
        <strong className="gameResultTitle">{title}</strong>
        <span className="gameResultSub">{subtitle}</span>
        <span className="gameResultMoney">{money}</span>
        <div className="gameResultActions">
          <button className="smallButton ghost" onClick={onClose}>
            {mySeat ? "게임 종료" : "닫기"}
          </button>
          {mySeat && onRematch && (
            <button className="primaryButton" disabled={busy} onClick={onRematch}>
              🔁 재경기 요청
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 상대가 보낸 재경기 신청
export function RematchOfferPopup({
  from,
  stakeText,
  busy,
  onAccept,
  onDecline,
}: {
  from: string;
  stakeText: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="gameResultBackdrop" role="presentation">
      <div className="gameResultCard offer" role="dialog" aria-modal="true" aria-label="재경기 신청">
        <span className="gameResultIcon" aria-hidden="true">🔁</span>
        <strong className="gameResultTitle">재경기 신청</strong>
        <span className="gameResultSub">{from}님이 한 판 더 하자고 해요!</span>
        <span className="gameResultMoney">{stakeText}</span>
        <div className="gameResultActions">
          <button className="smallButton ghost" disabled={busy} onClick={onDecline}>거절</button>
          <button className="primaryButton" disabled={busy} onClick={onAccept}>수락</button>
        </div>
      </div>
    </div>
  );
}
