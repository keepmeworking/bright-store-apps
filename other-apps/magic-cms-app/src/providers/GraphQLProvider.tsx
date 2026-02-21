import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { PropsWithChildren, useMemo } from "react";
import { Provider } from "urql";
import { Box, Spinner, Text } from "@saleor/macaw-ui";

import { createClient } from "@/lib/create-graphql-client";
import { normalizeSaleorApiUrl } from "@/lib/saleor-api-url";

export function GraphQLProvider(props: PropsWithChildren<{}>) {
  const { appBridgeState, appBridge } = useAppBridge();
  const url = appBridgeState?.saleorApiUrl;
  const token = appBridgeState?.token;

  const client = useMemo(() => {
    if (!url || !token) return null;
    const finalUrl = normalizeSaleorApiUrl(url);
    return createClient(finalUrl, () => appBridge?.getState().token ?? token);
  }, [url, token, appBridge]);

  // CRITICAL: Never render children without the urql Provider!
  // If we don't have a valid client yet, show a loading indicator.
  // Rendering children without a Provider causes useClient() to throw.
  if (!client) {
    return (
      <Box
        padding={8}
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        gap={4}
        style={{ minHeight: "50vh" }}
      >
        <Spinner />
        <Text color="default2" size={2}>
          {!url ? "Waiting for Saleor connection..." : "Authenticating..."}
        </Text>
      </Box>
    );
  }

  return <Provider value={client} {...props} />;
}
