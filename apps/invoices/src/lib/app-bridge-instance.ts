import { AppBridge } from "@saleor/app-sdk/app-bridge";

export const appBridgeInstance = typeof window !== "undefined" ? new AppBridge() : undefined;
