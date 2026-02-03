import { promises as fs } from "fs";
import { err, ok, Result } from "neverthrow";
import path from "path";

import { createLogger } from "@/lib/logger";
import { StripePublishableKey } from "@/modules/stripe/stripe-publishable-key";
import { StripeRestrictedKey } from "@/modules/stripe/stripe-restricted-key";
import { StripeWebhookSecret } from "@/modules/stripe/stripe-webhook-secret";

import { AppRootConfig } from "../../domain/app-root-config";
import { StripeConfig } from "../../domain/stripe-config";
import {
  AppConfigRepo,
  AppConfigRepoError,
  BaseAccessPattern,
  GetStripeConfigAccessPattern,
} from "../app-config-repo";

// Define the shape of the data stored in the file
interface SerializedData {
  chanelConfigMapping: Record<string, string>;
  stripeConfigsById: Record<
    string,
    {
      name: string;
      id: string;
      restrictedKey: string; // Serialized usually as string
      publishableKey: string;
      webhookSecret: string;
      webhookId: string;
    }
  >;
}

export class FileAppConfigRepo implements AppConfigRepo {
  private logger = createLogger("FileAppConfigRepo");
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async readData(): Promise<SerializedData> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");

      return JSON.parse(content) as SerializedData;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "ENOENT") {
        return { chanelConfigMapping: {}, stripeConfigsById: {} };
      }
      this.logger.error({ error: e }, "Failed to read config file");
      throw e;
    }
  }

  private async writeData(data: SerializedData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async saveStripeConfig(args: {
    config: StripeConfig;
    saleorApiUrl: string;
    appId: string;
  }): Promise<Result<null | void, InstanceType<typeof AppConfigRepoError.FailureSavingConfig>>> {
    try {
      const data = await this.readData();

      data.stripeConfigsById[args.config.id] = {
        name: args.config.name,
        id: args.config.id,
        restrictedKey: args.config.restrictedKey,
        publishableKey: args.config.publishableKey,
        webhookSecret: args.config.webhookSecret,
        webhookId: args.config.webhookId,
      };
      await this.writeData(data);

      return ok(null);
    } catch (e) {
      this.logger.error(e, "Failed to save config");

      return err(new AppConfigRepoError.FailureSavingConfig("Failed to save config"));
    }
  }

  async getStripeConfig(
    access: GetStripeConfigAccessPattern,
  ): Promise<
    Result<StripeConfig | null, InstanceType<typeof AppConfigRepoError.FailureFetchingConfig>>
  > {
    try {
      const data = await this.readData();
      let configId: string | undefined;

      if ("configId" in access) {
        configId = access.configId;
      } else if ("channelId" in access) {
        configId = data.chanelConfigMapping[access.channelId];
      }

      if (!configId) return ok(null);

      const serializedConfig = data.stripeConfigsById[configId];

      if (!serializedConfig) return ok(null);

      const configResult = StripeConfig.create({
        ...serializedConfig,
        restrictedKey: serializedConfig.restrictedKey as StripeRestrictedKey,
        publishableKey: serializedConfig.publishableKey as StripePublishableKey,
        webhookSecret: serializedConfig.webhookSecret as StripeWebhookSecret,
      });

      if (configResult.isErr()) {
        this.logger.error("Failed to deserialize config from file", configResult.error);

        // Maybe return error? But interface expects StripeConfig | null
        return err(new AppConfigRepoError.FailureFetchingConfig("Failed to deserialize config"));
      }

      return ok(configResult.value);
    } catch (e) {
      this.logger.error(e, "Failed to fetch config");

      return err(new AppConfigRepoError.FailureFetchingConfig("Failed to fetch config"));
    }
  }

  async getRootConfig(
    _access: BaseAccessPattern,
  ): Promise<Result<AppRootConfig, InstanceType<typeof AppConfigRepoError.FailureFetchingConfig>>> {
    try {
      const data = await this.readData();
      const stripeConfigsById: Record<string, StripeConfig> = {};

      for (const [id, raw] of Object.entries(data.stripeConfigsById)) {
        const res = StripeConfig.create({
          ...raw,
          restrictedKey: raw.restrictedKey as StripeRestrictedKey,
          publishableKey: raw.publishableKey as StripePublishableKey,
          webhookSecret: raw.webhookSecret as StripeWebhookSecret,
        });

        if (res.isOk()) {
          stripeConfigsById[id] = res.value;
        }
      }

      return ok(new AppRootConfig(data.chanelConfigMapping, stripeConfigsById));
    } catch (e) {
      this.logger.error(e, "Failed to get root config");

      return err(new AppConfigRepoError.FailureFetchingConfig("Failed to get root config"));
    }
  }

  async removeConfig(
    _access: BaseAccessPattern,
    data: { configId: string },
  ): Promise<Result<null, InstanceType<typeof AppConfigRepoError.FailureRemovingConfig>>> {
    try {
      const fileData = await this.readData();

      delete fileData.stripeConfigsById[data.configId];

      // Also remove mappings pointing to this config
      for (const [channelId, configId] of Object.entries(fileData.chanelConfigMapping)) {
        if (configId === data.configId) {
          delete fileData.chanelConfigMapping[channelId];
        }
      }

      await this.writeData(fileData);

      return ok(null);
    } catch (e) {
      this.logger.error(e, "Failed to remove config");

      return err(new AppConfigRepoError.FailureRemovingConfig("Failed to remove config"));
    }
  }

  async updateMapping(
    _access: BaseAccessPattern,
    data: { configId: string | null; channelId: string },
  ): Promise<Result<void | null, InstanceType<typeof AppConfigRepoError.FailureSavingConfig>>> {
    try {
      const fileData = await this.readData();

      if (data.configId === null) {
        delete fileData.chanelConfigMapping[data.channelId];
      } else {
        fileData.chanelConfigMapping[data.channelId] = data.configId;
      }
      await this.writeData(fileData);

      return ok(null);
    } catch (e) {
      this.logger.error(e, "Failed to update mapping");

      return err(new AppConfigRepoError.FailureSavingConfig("Failed to update mapping"));
    }
  }
}
