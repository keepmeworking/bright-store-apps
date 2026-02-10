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
export const saleorApp = new SaleorApp({
  apl,
});

export const REQUIRED_SALEOR_VERSION = ">=3.10 <4";

