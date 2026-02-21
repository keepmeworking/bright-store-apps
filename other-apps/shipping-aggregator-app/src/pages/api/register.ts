
import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";

/**
 * Endpoint for Saleor to exchange registration token for persistent access token.
 */
export default createAppRegisterHandler({
  apl: saleorApp.apl,
});
