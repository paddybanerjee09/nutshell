import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ["@nutshell/server"],
  experimental: process.platform === "win32" ? { cpus: 2 } : undefined,
  turbopack: { root: fileURLToPath(new URL("../../", import.meta.url)) },
};

export default config;
