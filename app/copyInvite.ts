// 게임 초대 링크 복사 (개인톡 등으로 보낼 수 있게)
export async function copyInviteLink(kind: "omok" | "alkkagi" | "catch", id: string): Promise<string> {
  const label = kind === "omok" ? "🏁 오목" : kind === "alkkagi" ? "🥏 알까기" : "🎨 캐치마인드";
  const link = `${window.location.origin}/game?${kind}=${id}`; // /game: 카톡 미리보기에 게임 제목
  const text = `${label} 같이 해요!\n👉 ${link}`;
  try {
    await navigator.clipboard.writeText(text);
    return "🔗 초대 링크를 복사했어요. 개인톡에 붙여넣어 보내세요.";
  } catch {
    // 클립보드를 못 쓰는 브라우저(일부 인앱 브라우저): 직접 복사하도록 보여 준다
    window.prompt("아래 링크를 복사해서 보내세요.", link);
    return "🔗 링크를 길게 눌러 복사해 주세요.";
  }
}
