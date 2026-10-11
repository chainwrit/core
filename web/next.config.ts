import type { NextConfig } from "next";

const config: NextConfig = {
  // Anchor and web3.js pull in node-only modules; keep them out of the bundle.
  serverExternalPackages: ["@coral-xyz/anchor", "@chainwrit/sdk"],
};

export default config;
