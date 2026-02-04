import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: [
    "@saleor/app-sdk",
    "@saleor/macaw-ui",
  ],
  bundlePagesRouterDependencies: true,
  experimental: {
    optimizePackageImports: ["@saleor/macaw-ui"],
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const CopyPlugin = require("copy-webpack-plugin");

      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.join(
                path.dirname(require.resolve("pdfkit/package.json")),
                "js/data"
              ),
              to: path.join(__dirname, ".next/server/vendor-chunks/data"),
            },
          ],
        })
      );
    }
    return config;
  },
};

export default nextConfig;
