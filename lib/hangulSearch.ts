// 한글 초성 검색: "ㅍ" → 푸들·퐁당, "ㅍㄷ" → 푸들·퐁당, "푸ㄷ" → 푸들
// 띄어쓰기·대소문자는 무시하고, 이름 중간도 찾는다.

const CHOSUNG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

function chosungOf(char: string) {
  const code = char.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return char;
  return CHOSUNG[Math.floor(code / 588)];
}

export function matchesHangul(name: string, query: string) {
  const q = query.split(" ").join("").toLowerCase();
  if (!q) return true;
  const n = name.split(" ").join("").toLowerCase();
  for (let start = 0; start + q.length <= n.length; start += 1) {
    let ok = true;
    for (let i = 0; i < q.length && ok; i += 1) {
      const c = n[start + i];
      ok = CHOSUNG.includes(q[i]) ? chosungOf(c) === q[i] : c === q[i];
    }
    if (ok) return true;
  }
  return false;
}
