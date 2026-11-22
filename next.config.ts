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
    const common = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]
    return [
      // /v1/* is the API behind the BFF: it sets its own Content-Security-Policy (the branding images carry `default-src 'none'; sandbox`) and a framework header would replace it.
      { source: "/v1/:path*", headers: common },
      { source: "/((?!v1(?:/|$)).*)", headers: [...common, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
    ]
  },
}

export default nextConfig
