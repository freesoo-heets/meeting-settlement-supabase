// 친선전 티켓: 평일 08:00~20:00 (한국 시간)에만 1장 든다. 그 외 시간 · 주말 · 공휴일 · 게스트는 무료.
// 봇(omok_bridge.py)의 HOLIDAYS · friendly_ticket_time() 과 같은 기준이어야 한다.

export const FRIENDLY_TICKET_HOURS = "평일 8~20시";

// 공휴일 (대체공휴일 포함). 해마다 추가한다.
export const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-05", "2026-05-25",
  "2026-06-03", "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-28", "2026-10-05", "2026-10-09", "2026-12-25",
  // 2027
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13", "2027-08-16",
  "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11", "2027-12-27",
]);

export function isFriendlyTicketTime(at: Date = new Date()) {
  const kst = new Date(at.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCDay(); // 0=일 6=토
  if (day === 0 || day === 6) return false;
  if (HOLIDAYS.has(kst.toISOString().slice(0, 10))) return false;
  const hour = kst.getUTCHours();
  return hour >= 8 && hour < 20;
}

// 화면 문구: 지금 티켓이 드는지까지
export function friendlyTicketText() {
  return isFriendlyTicketTime()
    ? `🎫 티켓 1장 (${FRIENDLY_TICKET_HOURS}만 · 게스트 무료)`
    : "🎫 지금은 티켓 없이 무료 (평일 8~20시만 1장)";
}
