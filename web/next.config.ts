import type { NextConfig } from "next";

// The browser only ever talks to this origin; /backend/* is proxied to the Django API. That keeps the httpOnly
// session cookie first-party (no CORS, no third-party cookie problems).
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
