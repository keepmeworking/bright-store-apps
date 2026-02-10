import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Table } from "dynamodb-toolbox";

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

  static getPrimaryKeyScopedToSaleorApiUrl({
    saleorApiUrl,
  }: {
    saleorApiUrl: string;
  }): `${string}` {
    return `${saleorApiUrl}` as const;
  }
}

import { createDynamoDBClient, createDynamoDBDocumentClient } from "./dynamodb-client";

const client = createDynamoDBClient();
const documentClient = createDynamoDBDocumentClient(client);

export const dynamoMainTable = DynamoMainTable.create({
  documentClient,
  tableName: process.env.DYNAMODB_MAIN_TABLE_NAME || "SaleorAppsAPL",
});
