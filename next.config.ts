import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // The Docker web image has no API dependencies installed: its type check uses tsconfig.build.json (no tests that import API sources).
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // Shared pure rules ship as TypeScript source.
  transpilePackages: ["@opsdesk/domain"],
  // Every route: nothing may frame the app (clickjacking), outbound links get no path/query in the referrer, no content sniffing.
  // Deliberately NOT a full Content-Security-Policy: only the frame-ancestors directive.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ]
  },
}

export default nextConfig
