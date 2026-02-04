import { gql } from "urql";
import { SaleorVersionQuery } from "../../../generated/graphql";
import { REQUIRED_SALEOR_VERSION, saleorApp } from "../../saleor-app";
import { SaleorVersionCompatibilityValidator } from "../../lib/saleor-version-compatibility-validator";
import { createGraphQLClient } from "../../lib/create-graphql-client";
import { NextApiRequest, NextApiResponse } from "next";

const allowedUrlsPattern = process.env.ALLOWED_DOMAIN_PATTERN;

const SaleorVersion = gql`
  query SaleorVersion {
    shop {
      version
    }
  }
`;

const AppIdQuery = gql`
  query AppId {
    app {
      id
    }
  }
`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  console.log("Manual register handler called - Full Version");

  if (req.method !== "POST") {
    console.log("Method not allowed:", req.method);
    res.status(405).end();
    return;
  }

  // 1. Extract data from request
  // Saleor sends domain and api-url in headers
  const domain = req.headers["saleor-domain"] as string;
  const saleorApiUrl = req.headers["saleor-api-url"] as string;
  
  // Saleor sends auth-token in body
  const token = req.body?.auth_token as string;

  console.log("Extracted data:", { 
    domain, 
    saleorApiUrl, 
    hasToken: !!token,
    bodyKeys: Object.keys(req.body ?? {}),
    headerKeys: Object.keys(req.headers)
  });

  if (!saleorApiUrl || !token) {
    console.log("Missing required fields (api-url or token)");
    res.status(400).json({ message: "Missing required fields" });
    return;
  }

  try {
    // 2. Verify Allowed URL
    if (allowedUrlsPattern) {
      console.log("Verifying allowed URL pattern...");
      const regex = new RegExp(allowedUrlsPattern);
      if (!regex.test(saleorApiUrl)) {
        console.log("URL not allowed by pattern:", saleorApiUrl);
        res.status(403).json({ message: "URL not allowed" });
        return;
      }
    }

    // 3. Create temporary client to fetch App ID
    console.log("Creating temp GraphQL client for App ID...");
    const tempClient = createGraphQLClient({
      saleorApiUrl,
      token,
    });

    console.log("Fetching App ID...");
    const appIdResponse = await tempClient.query(AppIdQuery, {}).toPromise();
    const appId = appIdResponse.data?.app?.id;
    console.log("App ID fetched:", appId);

    if (!appId) {
      throw new Error("Could not fetch App ID from Saleor. Check if token is valid.");
    }

    // 4. Fetch JWKS
    console.log("Fetching JWKS...");
    const jwksUrl = new URL(saleorApiUrl);
    jwksUrl.pathname = "/.well-known/jwks.json";
    const jwksResponse = await fetch(jwksUrl.href);
    const jwks = await jwksResponse.text();
    console.log("JWKS fetched length:", jwks.length);

    // 5. Set APL
    console.log("Setting APL...");
    await saleorApp.apl.set({
      domain,
      token,
      saleorApiUrl,
      appId,
      jwks,
    });
    console.log("APL set successfully");

    // 6. Verify Saleor Version
    console.log("Verifying Saleor version...");
    const saleorVersion = await tempClient
      .query<SaleorVersionQuery>(SaleorVersion, {})
      .toPromise()
      .then((res) => res.data?.shop.version);

    console.log("Saleor version:", saleorVersion);

    if (!saleorVersion) {
      throw new Error("Saleor Version couldnt be fetched from the API");
    }

    new SaleorVersionCompatibilityValidator(
      REQUIRED_SALEOR_VERSION,
    ).validateOrThrow(saleorVersion);

    console.log("Registration successful!");
    res.status(200).json({ success: true });
  } catch (e: unknown) {
    console.error("Error in registration process:", e);
    const message = (e as Error)?.message ?? "Unknown error";
    res.status(400).json({ message });
  }
}
