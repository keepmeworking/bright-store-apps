import { createHttpBatchLink } from "@saleor/apps-trpc/http-batch-link";
import { createTRPCNext } from "@trpc/next";

import { appBridgeInstance } from "@/pages/_app";

import { TrpcRouter } from "./trpc-router";

export const trpcClient = createTRPCNext<TrpcRouter>({
  config() {
    return {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error - SDK version mismatch between packages/shared and stripe
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
