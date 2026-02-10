import { AppBridge } from "@saleor/app-sdk/app-bridge";

export const appBridgeInstance =
  typeof window !== "undefined"
    ? (() => {
        try {
          return new AppBridge();
        } catch {
          return undefined;
        }
      })()
    : undefined;
