/**
 * TAROT-Bank multi-zone routing. Set TAROT_ZONE_ORIGIN to the reviewed
 * HTTPS origin of the deployed Tarot-Bank zone (no trailing slash).
 * Without this variable the existing /tarot portal remains available.
 * Never point this at the meeting site's own origin (rewrite loop).
 */
const origin = process.env.TAROT_ZONE_ORIGIN;
const validOrigin = (() => {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    if (url.hostname === "gangseojjinc.vercel.app") return null;
    return url.origin;
  } catch { return null; }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (!validOrigin) return [];
    return [
      { source: "/tarot", destination: `${validOrigin}/tarot` },
      { source: "/tarot/:path*", destination: `${validOrigin}/tarot/:path*` },
    ];
  },
};
module.exports = nextConfig;
