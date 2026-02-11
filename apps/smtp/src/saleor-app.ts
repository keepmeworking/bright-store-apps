import { APL } from "@saleor/app-sdk/APL";
import { DynamoAPL } from "@saleor/app-sdk/APL/dynamodb";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { UpstashAPL } from "@saleor/app-sdk/APL/upstash";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";

import { env } from "./env";
import { createLogger } from "./logger";
import { dynamoMainTable } from "./modules/dynamodb/dynamo-main-table";

const logger = createLogger("saleor-app");

const aplType = env.APL;

export let apl: APL;

switch (aplType) {
  case "dynamodb": {
    apl = DynamoAPL.create({
      table: dynamoMainTable,
      externalLogger: (message, level) => {
        if (level === "error") {
          logger.error(`[DynamoAPL] ${message}`);
        } else {
          logger.debug(`[DynamoAPL] ${message}`);
        }
      },
    });

    break;
  }

  case "upstash":
    apl = new UpstashAPL();

    break;

  case "file":
    apl = new FileAPL({
      fileName: env.FILE_APL_PATH,
    });

    break;

  default: {
    throw new Error("Invalid APL config, ");
  }
}
/**
 * RobustAPL wraps an existing APL and tries to find auth data by toggling the trailing slash
 * if the first attempt fails. This helps with Saleor API URL discrepancies.
 */
class RobustAPL implements APL {
  constructor(private apl: APL) {}

  async get(saleorApiUrl: string) {
    let authData = await this.apl.get(saleorApiUrl);

    if (!authData) {
      const alternativeUrl = saleorApiUrl.endsWith("/")
        ? saleorApiUrl.slice(0, -1)
        : `${saleorApiUrl}/`;

      authData = await this.apl.get(alternativeUrl);
    }

    return authData;
  }

  async set(authData: any) {
    return this.apl.set(authData);
  }

  async delete(saleorApiUrl: string) {
    return this.apl.delete(saleorApiUrl);
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

export const REQUIRED_SALEOR_VERSION = ">=3.11.7 <4";
