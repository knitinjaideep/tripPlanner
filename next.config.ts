import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Invitation pages carry a secret in the URL: never cache them, never index them, and never
    // send the URL onward in a Referer header. (The login page is included because it can be
    // reached from an invitation.)
    const private_ = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/invite", headers: private_ },
      { source: "/invite/:path*", headers: private_ },
      { source: "/login", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
