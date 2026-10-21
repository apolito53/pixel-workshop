import type { NextConfig } from "next";
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  // Vinext generates .next metadata; keep native Next.js output separate.
  distDir: '.next-native',
  // Vinext ignores webpack plugins and keeps the R2 adapter. Native Next.js
  // replaces that module before resolving its Cloudflare-only dependency.
  webpack(config,{webpack}) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/(?:^|\/)cloud-store\.ts$/, (resource:{request:string}) => {
      resource.request=fileURLToPath(new URL('./lib/vercel-store.ts',import.meta.url));
    }));
    return config;
  },
};

export default nextConfig;
