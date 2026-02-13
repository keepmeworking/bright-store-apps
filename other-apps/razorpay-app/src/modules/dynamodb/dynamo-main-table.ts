import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Table } from "dynamodb-toolbox";
import { env } from "@/env";
import { createDynamoDBClient, createDynamoDBDocumentClient } from "./dynamodb-client";

type PartitionKey = { name: "PK"; type: "string" };
type SortKey = { name: "SK"; type: "string" };

export class DynamoMainTable extends Table<PartitionKey, SortKey> {
  private constructor(args: ConstructorParameters<typeof Table<PartitionKey, SortKey>>[number]) {
    super(args);
  }

  static create({
    documentClient,
    tableName,
  }: {
    documentClient: DynamoDBDocumentClient;
    tableName: string;
  }): DynamoMainTable {
    return new DynamoMainTable({
      documentClient,
      name: tableName,
      partitionKey: { name: "PK", type: "string" },
      sortKey: {
        name: "SK",
        type: "string",
      },
    });
  }
}

// Initialize only if DynamoDB APL is requested
let dynamoMainTable: DynamoMainTable | undefined;

if (env.APL === "dynamodb") {
  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.DYNAMODB_MAIN_TABLE_NAME) {
    throw new Error("Missing DynamoDB configuration");
  }

  const client = createDynamoDBClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const documentClient = createDynamoDBDocumentClient(client);

  dynamoMainTable = DynamoMainTable.create({
    documentClient,
    tableName: env.DYNAMODB_MAIN_TABLE_NAME,
  });
}

export { dynamoMainTable };
