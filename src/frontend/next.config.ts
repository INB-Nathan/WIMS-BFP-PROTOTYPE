import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Type errors are enforced via `npx tsc --noEmit` (builds fail on errors).
    // tsconfig.json has no test file exclusions; all .ts/.tsx files are type-checked.
  },
};

export default nextConfig;
