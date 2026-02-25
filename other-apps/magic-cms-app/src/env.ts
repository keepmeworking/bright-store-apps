import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    APL: z.enum(["file", "dynamodb", "upstash"]).default("file"),
    APP_API_BASE_URL: z.string().optional(),
    APP_IFRAME_BASE_URL: z.string().optional(),
    FILE_APL_PATH: z.string().default(".data/apl.json"),
    DYNAMODB_MAIN_TABLE_NAME: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    MANIFEST_APP_ID: z.string().default("magic-cms.app"),
    PORT: z.coerce.number().default(3002),
    SECRET_KEY: z.string(),
  },
  runtimeEnv: {
    APL: process.env.APL,
    APP_API_BASE_URL: process.env.APP_API_BASE_URL,
    APP_IFRAME_BASE_URL: process.env.APP_IFRAME_BASE_URL,
    FILE_APL_PATH: process.env.FILE_APL_PATH,
    DYNAMODB_MAIN_TABLE_NAME: process.env.DYNAMODB_MAIN_TABLE_NAME,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    MANIFEST_APP_ID: process.env.MANIFEST_APP_ID,
    PORT: process.env.PORT,
    SECRET_KEY: process.env.SECRET_KEY,
  },
  isServer: typeof window === "undefined",
});
