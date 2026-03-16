import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import packageJson from "@/package.json";
import { env } from "@/env";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const normalizeUrl = (value: string) => value.replace(/\/$/, "");
    const isTryCloudflareHost = (value: string) => {
      try {
        return new URL(value).hostname.endsWith(".trycloudflare.com");
      } catch {
        return false;
      }
    };

    const resolveBaseUrl = (configured: string | undefined, fallback: string) => {
      if (!configured) {
        return normalizeUrl(fallback);
      }

      const configuredUrl = normalizeUrl(configured);
      const fallbackUrl = normalizeUrl(fallback);

      // Quick tunnels rotate frequently. If env points to an older quick-tunnel
      // and request is coming from a new quick-tunnel host, trust request host.
      if (
        isTryCloudflareHost(configuredUrl) &&
        isTryCloudflareHost(fallbackUrl) &&
        configuredUrl !== fallbackUrl
      ) {
        return fallbackUrl;
      }

      return configuredUrl;
    };

    const apiBaseURL = resolveBaseUrl(env.APP_API_BASE_URL, appBaseUrl);
    const iframeBaseUrl = resolveBaseUrl(env.APP_IFRAME_BASE_URL, appBaseUrl);
    const normalizedApiBaseURL = normalizeUrl(apiBaseURL);

    const manifest: AppManifest = {
      id: "magic-cms.app",
      version: packageJson.version,
      name: "Magic CMS",
      about: "Dynamic storefront CMS — manage widgets, reviews, shoppable videos, and analytics from Saleor Dashboard.",
      tokenTargetUrl: `${normalizedApiBaseURL}/api/register`,
      appUrl: iframeBaseUrl,
      permissions: [
        "MANAGE_PAGES",
        "MANAGE_PAGE_TYPES_AND_ATTRIBUTES",
        "MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES",
        "MANAGE_MENUS",
        "MANAGE_PRODUCTS",
        "MANAGE_ORDERS",
        "MANAGE_CHECKOUTS",
        "MANAGE_CHANNELS",
      ],
      webhooks: [],
      author: "Brightcode Canvas",
      brand: {
        logo: {
          default: `${normalizedApiBaseURL}/logo.svg`,
        },
      },
    };

    return manifest;
  },
});
