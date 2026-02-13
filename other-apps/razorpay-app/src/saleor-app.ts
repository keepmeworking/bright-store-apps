import { APL } from "@saleor/app-sdk/APL";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { UpstashAPL } from "@saleor/app-sdk/APL/upstash";
import { DynamoAPL } from "@saleor/app-sdk/APL/dynamodb";
import { env } from "@/env";
import { dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

export let apl: APL;

switch (env.APL) {
  case "upstash":
    apl = new UpstashAPL();
    break;
  case "dynamodb":
    if (!dynamoMainTable) {
      throw new Error("DynamoDB table not initialized. Check your environment variables.");
    }
    apl = DynamoAPL.create({
      table: dynamoMainTable,
    });
    break;
  case "file":
    apl = new FileAPL({
      fileName: env.FILE_APL_PATH,
    });
    break;
  default:
    apl = new FileAPL({
      fileName: env.FILE_APL_PATH,
    });
}

export const saleorApp = new SaleorApp({
  apl,
});
