import { APL } from "@saleor/app-sdk/APL";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { UpstashAPL } from "@saleor/app-sdk/APL/upstash";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { env } from "@/env";

export let apl: APL;

switch (env.APL) {
  case "upstash":
    apl = new UpstashAPL();
    break;
  case "dynamodb":
    console.warn("DynamoDB APL requested but this app runtime is configured for File/Upstash only. Falling back to FileAPL.");
    apl = new FileAPL({
      fileName: env.FILE_APL_PATH,
    });
    break;
  case "file":
  default:
    apl = new FileAPL({
      fileName: env.FILE_APL_PATH,
    });
}

export const saleorApp = new SaleorApp({
  apl,
});
