import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import packageJson from "@/package.json";
import { env } from "@/env";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const apiBaseURL = env.APP_API_BASE_URL ?? appBaseUrl;
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;
    const normalizedApiBaseURL = apiBaseURL.replace(/\/$/, "");

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
          default: `${normalizedApiBaseURL}/logo.png`,
        },
      },
    };

    return manifest;
  },
});
