import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // Shared pure rules ship as TypeScript source.
  transpilePackages: ["@opsdesk/domain"],
}

export default nextConfig
