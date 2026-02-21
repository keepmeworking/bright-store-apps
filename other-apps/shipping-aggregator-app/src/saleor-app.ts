import { APL } from "@saleor/app-sdk/APL";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { DynamoAPL } from "@saleor/app-sdk/APL/dynamodb";
import { env } from "@/env";
import { dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";

export let apl: APL;

switch (env.APL) {
  case "dynamodb":
    if (dynamoMainTable) {
        apl = DynamoAPL.create({
          table: dynamoMainTable,
        });
    } else {
        console.warn("DynamoDB APL requested but configuration missing. Falling back to FileAPL.");
        apl = new FileAPL({
            fileName: env.FILE_APL_PATH,
        });
    }
    break;
  default:
    apl = new FileAPL({
      fileName: env.FILE_APL_PATH,
    });
}

export const saleorApp = new SaleorApp({
  apl,
});
