import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    APL: z.enum(["file", "dynamodb"]).default("file"),
    APP_API_BASE_URL: z.string().optional(),
    APP_IFRAME_BASE_URL: z.string().optional(),
    FILE_APL_PATH: z.string().default(".data/apl.json"),
    PORT: z.coerce.number().default(3000),
    SECRET_KEY: z.string().default("test_secret"), // Default for dev
    DYNAMODB_MAIN_TABLE_NAME: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    SHIPROCKET_EMAIL: z.string().optional(),
    SHIPROCKET_PASSWORD: z.string().optional(),
    SHIPROCKET_PICKUP_PINCODE: z.string().optional(),
    SHIPROCKET_PICKUP_LOCATION: z.string().optional(),
  },
  runtimeEnv: {
    APL: process.env.APL,
    APP_API_BASE_URL: process.env.APP_API_BASE_URL,
    APP_IFRAME_BASE_URL: process.env.APP_IFRAME_BASE_URL,
    FILE_APL_PATH: process.env.FILE_APL_PATH,
    PORT: process.env.PORT,
    SECRET_KEY: process.env.SECRET_KEY,
    DYNAMODB_MAIN_TABLE_NAME: process.env.DYNAMODB_MAIN_TABLE_NAME,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    SHIPROCKET_EMAIL: process.env.SHIPROCKET_EMAIL,
    SHIPROCKET_PASSWORD: process.env.SHIPROCKET_PASSWORD,
    SHIPROCKET_PICKUP_PINCODE: process.env.SHIPROCKET_PICKUP_PINCODE,
    SHIPROCKET_PICKUP_LOCATION: process.env.SHIPROCKET_PICKUP_LOCATION,
  },
  isServer: typeof window === "undefined",
});
