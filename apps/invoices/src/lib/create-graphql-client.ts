import { authExchange } from "@urql/exchange-auth";
import {
  cacheExchange,
  fetchExchange,
  createClient as urqlCreateClient,
} from "urql";

export interface CreateGraphQLClientArgs {
  saleorApiUrl: string;
  token?: string;
}

/*
 * Creates instance of urql client with optional auth exchange (if token is provided).
 * Uses the @urql/exchange-auth 2.x API which is compatible with urql 4.x.
 */
export const createGraphQLClient = ({
  saleorApiUrl,
  token,
}: CreateGraphQLClientArgs) => {
  console.log("urqlCreateClient calling...");
  return urqlCreateClient({
    url: saleorApiUrl,
    exchanges: [
      cacheExchange,
      authExchange(async (utils) => {
        console.log("authExchange initializing...");
        return {
          addAuthToOperation(operation) {
            console.log("addAuthToOperation called");
            if (!token) {
              return operation;
            }
            return utils.appendHeaders(operation, {
              "Authorization-Bearer": token,
            });
          },
          didAuthError(error) {
            return error.graphQLErrors.some(
              (e) => e.extensions?.code === "FORBIDDEN",
            );
          },
          async refreshAuth() {
            // No refresh logic needed for server-side token usage
          },
        };
      }),
      fetchExchange,
    ],
  });
};
