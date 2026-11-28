# Tarot zone integration verification (B: independent login)

- Meeting main baseline: 1b5f1259827ce52d2142cff8b09a81f2e5116ea2.
- Tarot zone preview: https://tarot-bank-aclfuiy93-pong-dang.vercel.app/tarot
- TAROT_ZONE_ORIGIN is configured ONLY for this meeting preview Git branch, not production.
- PET routes, crons and data are untouched.

## Required acceptance checks before merge

1. GET /tarot renders the Tarot home from the zone, not the legacy portal.
2. /tarot/login login and logout use Tarot cookies scoped to /tarot, not Meeting cookies.
3. All 78 card images load under /tarot/tarot/cards/ and card-back loads.
4. Three-card, six-month and Celtic-cross reading flows complete.
5. AI follow-up and server-backed reading history work; verify localStorage history behavior when moving origins.
6. Admin login and admin API work with isolated cookie.
7. Kakao sharing points to https://gangseojjinc.vercel.app/tarot after production cutover.
8. PET /api/pet/* and main member/settlement/game paths remain unchanged.
9. Confirm preview deployment access (Vercel preview authentication may block cross-zone rewrites).
10. Check both desktop and mobile responsive layouts.

## Rollback

Remove TAROT_ZONE_ORIGIN or roll back the meeting deployment; existing portal remains fallback. Do not shut down the independent Tarot site until acceptance checks pass.
