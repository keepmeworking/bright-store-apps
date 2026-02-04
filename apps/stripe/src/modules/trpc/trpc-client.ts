import { createHttpBatchLink } from "@saleor/apps-trpc/http-batch-link";
import { createTRPCNext } from "@trpc/next";

import { appBridgeInstance } from "@/pages/_app";

import { TrpcRouter } from "./trpc-router";

export const trpcClient = createTRPCNext<TrpcRouter>({
  config() {
    return {
      // @ts-expect-error - SDK version mismatch between packages/shared and stripe, functionally correct
      links: [createHttpBatchLink(appBridgeInstance)],
      queryClientConfig: {
        defaultOptions: {
          queries: {
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      },
    };
  },
  ssr: false,
});
