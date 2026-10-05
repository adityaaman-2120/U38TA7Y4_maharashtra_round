import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// The browser only ever talks to this origin; /backend/* is proxied to the Django API. That keeps the httpOnly
// session cookie first-party (no CORS, no third-party cookie problems).
// BACKEND_URL is the Django service's base URL (server-side only, never sent to the browser). A production build without it would
// silently proxy to localhost, so fail the build instead.
if (process.env.VERCEL && !process.env.BACKEND_URL) throw new Error("Set BACKEND_URL (the Render service URL) in the Vercel project settings.");
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // A sleeping Render service needs ~50s to wake; the default 30s proxy timeout would cut that request off.
  experimental: { proxyTimeout: 120_000 },
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
