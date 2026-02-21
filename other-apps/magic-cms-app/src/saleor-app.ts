import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { env } from "@/env";

export const apl = new FileAPL({
  fileName: env.FILE_APL_PATH,
});

export const saleorApp = new SaleorApp({
  apl,
});
