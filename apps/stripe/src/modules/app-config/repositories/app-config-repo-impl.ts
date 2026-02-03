import path from "path";

import { env } from "@/lib/env";

import { DynamodbAppConfigRepo } from "./dynamodb/dynamodb-app-config-repo";
import { FileAppConfigRepo } from "./file/file-app-config-repo";

/*
 * Replace this implementation with custom DB (Redis, Metadata etc) to drop DynamoDB and bring something else
 */
export const appConfigRepoImpl =
  env.APL === "file"
    ? new FileAppConfigRepo(path.join(process.cwd(), ".data", "stripe-config.json"))
    : new DynamodbAppConfigRepo();
