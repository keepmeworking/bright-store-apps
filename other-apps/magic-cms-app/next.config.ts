import path from "path";
import { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@saleor/macaw-ui"],
  serverExternalPackages: ["sharp", "@aws-sdk/client-s3"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // Remove X-Frame-Options so Saleor Dashboard can embed this app in an iframe
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            // Allow embedding from any origin (required for Cloudflare tunnel URLs)
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve = {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        react: path.resolve("./node_modules/react"),
        "react-dom": path.resolve("./node_modules/react-dom"),
      },
    };
    return config;
  },
};

export default config;
