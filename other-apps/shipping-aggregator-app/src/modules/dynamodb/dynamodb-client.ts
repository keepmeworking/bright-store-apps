import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const createDynamoDBClient = (config: { region?: string; credentials?: { accessKeyId: string; secretAccessKey: string } }) => {
  return new DynamoDBClient(config);
};

export const createDynamoDBDocumentClient = (client: DynamoDBClient) => {
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
};
