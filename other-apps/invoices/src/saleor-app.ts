import { APL } from "@saleor/app-sdk/APL";
import { DynamoAPL } from "@saleor/app-sdk/APL/dynamodb";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { UpstashAPL } from "@saleor/app-sdk/APL/upstash";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";

import { dynamoMainTable } from "./modules/dynamodb/dynamo-main-table";

const aplType = process.env.APL ?? "file";

let apl: APL;

switch (aplType) {
  case "dynamodb": {
    apl = DynamoAPL.create({
      table: dynamoMainTable,
    });

    break;
  }
  case "upstash":
    apl = new UpstashAPL();

    break;
  case "file":
    apl = new FileAPL({
      fileName: process.env.FILE_APL_PATH,
    });

    break;
  default: {
    throw new Error("Invalid APL config, ");
  }
}
const appPrefix = process.env.MANIFEST_APP_ID || "invoices";

/**
 * RobustAPL wraps an existing APL and tries to find auth data by toggling the trailing slash
 * if the first attempt fails. This helps with Saleor API URL discrepancies.
 * 
 * It also adds an app-specific prefix to the saleorApiUrl key to allow multiple apps 
 * to share the same DynamoDB table without overwriting each other's registrations.
 */
class RobustAPL implements APL {
  constructor(private apl: APL) {}

  private getPrefixedUrl(url: string) {
    return `${appPrefix}:${url}`;
  }

  async get(saleorApiUrl: string) {
    const prefixedUrl = this.getPrefixedUrl(saleorApiUrl);
    let authData = await this.apl.get(prefixedUrl);

    if (!authData) {
      const alternativeUrl = saleorApiUrl.endsWith("/")
        ? saleorApiUrl.slice(0, -1)
        : `${saleorApiUrl}/`;

      authData = await this.apl.get(this.getPrefixedUrl(alternativeUrl));
    }

    // Strip prefix from returned authData to keep Saleor SDK happy
    if (authData) {
      return {
        ...authData,
        saleorApiUrl: saleorApiUrl,
      };
    }

    return authData;
  }

  async set(authData: any) {
    // Store with prefixed URL
    return this.apl.set({
      ...authData,
      saleorApiUrl: this.getPrefixedUrl(authData.saleorApiUrl),
    });
  }

  async delete(saleorApiUrl: string) {
    return this.apl.delete(this.getPrefixedUrl(saleorApiUrl));
  }

  async getAll() {
    return this.apl.getAll();
  }

  async isReady() {
    if (this.apl.isReady) {
      return this.apl.isReady();
    }

    return { ready: true } as const;
  }

  async isConfigured() {
    if (this.apl.isConfigured) {
      return this.apl.isConfigured();
    }

    return { configured: true } as const;
  }
}

export const saleorApp = new SaleorApp({
  apl: new RobustAPL(apl),
});

export const REQUIRED_SALEOR_VERSION = ">=3.10 <4";

