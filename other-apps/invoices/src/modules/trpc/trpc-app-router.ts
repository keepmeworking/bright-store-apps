import { channelsRouter } from "../channels/channels.router";
import { router } from "./trpc-server";
import { shopInfoRouter } from "../shop-info/shop-info.router";
import { appConfigurationRouter } from "../app-configuration/app-configuration-router";
import { invoicesRouter } from "../invoices/invoices.router";

export const appRouter = router({
  channels: channelsRouter,
  appConfiguration: appConfigurationRouter,
  shopInfo: shopInfoRouter,
  invoices: invoicesRouter,
});

export type AppRouter = typeof appRouter;
