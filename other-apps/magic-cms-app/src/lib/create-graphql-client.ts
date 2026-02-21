import {
  cacheExchange,
  createClient as urqlCreateClient,
  fetchExchange,
} from "urql";

type TokenProvider = () => string | null | undefined;

/**
 * Custom fetch that validates the response is JSON before returning it.
 * Saleor returns the GraphQL Playground HTML page if:
 *  - The request is not POST
 *  - Content-Type is missing
 *  - The auth token is invalid/expired
 *
 * We intercept these to provide a clear error message instead of a cryptic parse error.
 */
const createSafeGraphQLFetch = (getToken: TokenProvider): typeof fetch => {
  return async (input, init) => {
    const hasBody = typeof init?.body !== "undefined";
    const method = (init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const activeToken = getToken();

    headers.set("Accept", "application/json");
    if (activeToken) {
      headers.set("Authorization", `Bearer ${activeToken}`);
      headers.set("Authorization-Bearer", activeToken);
    }
    if (hasBody || method === "POST") {
      headers.set("Content-Type", "application/json");
    }

    let finalInput: RequestInfo | URL = input;
    let finalMethod = method;
    let finalBody = init?.body;

    if (!hasBody && method === "GET") {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const parsedUrl = new URL(rawUrl);
      const query = parsedUrl.searchParams.get("query");
      const variablesRaw = parsedUrl.searchParams.get("variables");
      const operationName = parsedUrl.searchParams.get("operationName");

      let variables: Record<string, unknown> | undefined;
      if (variablesRaw) {
        try {
          variables = JSON.parse(variablesRaw);
        } catch {
          variables = undefined;
        }
      }

      if (query) {
        finalInput = parsedUrl.origin + parsedUrl.pathname;
        finalMethod = "POST";
        finalBody = JSON.stringify({
          query,
          variables,
          operationName: operationName || undefined,
        });
        headers.set("Content-Type", "application/json");
      }
    }

    const response = await fetch(finalInput, {
      ...init,
      method: finalMethod,
      body: finalBody,
      headers,
    });

    // Check if we got HTML instead of JSON
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      // Return a proper JSON error response so urql doesn't crash
      const targetUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : "Saleor API";
      const errorBody = JSON.stringify({
        errors: [
          {
            message:
              `Saleor API returned HTML (${response.status}) instead of JSON from ${targetUrl}. This usually means an invalid GraphQL URL (missing /graphql/) or an expired authentication token.`,
          },
        ],
      });
      return new Response(errorBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return response;
  };
};

/**
 * Creates a urql GraphQL client with direct auth headers and HTML response safety.
 * We bypass @urql/exchange-auth because its async getAuth() causes a race condition
 * where the first request fires before the token is resolved.
 */
export const createClient = (url: string, getToken: TokenProvider) =>
  urqlCreateClient({
    url,
    fetch: createSafeGraphQLFetch(getToken),
    exchanges: [cacheExchange, fetchExchange],
  });
