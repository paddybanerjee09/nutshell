import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ["@nutshell/server"],
  turbopack: { root: fileURLToPath(new URL("../../", import.meta.url)) },
};

export default config;
