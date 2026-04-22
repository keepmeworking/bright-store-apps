import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import { registry } from "@/core/registry";
import { resolveActiveProviderConfigs } from "@/modules/provider-configs";
import { ShiprocketProvider } from "@/providers/shiprocket";
import { RateRequest, ShippingProvider } from "@/providers/types";

type ShippingMethodsPayload = {
  checkout?: {
    shippingAddress?: {
      city?: string | null;
      postalCode?: string | null;
      country?: {
        code?: string | null;
      } | null;
    } | null;
    lines?: Array<{
      quantity?: number | null;
      variant?: {
        weight?: {
          value?: number | null;
          unit?: string | null;
        } | null;
      } | null;
    }> | null;
    totalPrice?: {
      gross?: {
        amount?: number | null;
      } | null;
    } | null;
  } | null;
};

const SHIPPING_METHODS_SUBSCRIPTION = /* GraphQL */ `
  subscription ShippingListMethodsForCheckout {
    event {
      ... on ShippingListMethodsForCheckout {
        checkout {
          id
          shippingAddress {
            city
            postalCode
            country {
              code
            }
          }
          totalPrice {
            gross {
              amount
            }
          }
          lines {
            quantity
            variant {
              weight {
                value
                unit
              }
            }
          }
        }
      }
    }
  }
`;

const shippingMethodsWebhook = new SaleorSyncWebhook<ShippingMethodsPayload>({
  name: "Shipping Methods For Checkout",
  webhookPath: "/api/webhooks/shipping-methods",
  event: "SHIPPING_LIST_METHODS_FOR_CHECKOUT",
  apl: saleorApp.apl,
  query: SHIPPING_METHODS_SUBSCRIPTION,
});

function normalizeWeight(weightValue?: number | null, weightUnit?: string | null) {
  if (typeof weightValue !== "number" || !Number.isFinite(weightValue)) {
    return 0;
  }

  const unit = (weightUnit || "KG").toUpperCase();

  if (unit === "G") {
    return weightValue / 1000;
  }

  if (unit === "LB") {
    return weightValue * 0.453592;
  }

  if (unit === "OZ") {
    return weightValue * 0.0283495;
  }

  return weightValue;
}

function getTotalCheckoutWeight(payload: ShippingMethodsPayload) {
  const lines = payload.checkout?.lines || [];

  const total = lines.reduce((acc, line) => {
    const quantity = typeof line?.quantity === "number" && Number.isFinite(line.quantity) ? Math.max(1, line.quantity) : 1;
    const value = line?.variant?.weight?.value;
    const unit = line?.variant?.weight?.unit;

    return acc + normalizeWeight(value, unit) * quantity;
  }, 0);

  if (!total || total <= 0) {
    return 0.5;
  }

  return Number(total.toFixed(3));
}

function getConfiguredProviders(saleorApiUrl: string): Array<{ provider: ShippingProvider; displayName: string; configId: string }> {
  const activeConfigs = resolveActiveProviderConfigs(saleorApiUrl);

  const configuredProviders = activeConfigs
    .map((config) => {
      if (config.provider !== "shiprocket") {
        return null;
      }

      return {
        provider: new ShiprocketProvider({
          email: config.credentials.email,
          password: config.credentials.password,
          pickupPincode: String(config.settings.pickupPincode || ""),
          pickupLocation: String(config.settings.pickupLocation || ""),
          enableCod: Boolean(config.settings.enableCod),
        }),
        displayName: config.name || "Shiprocket",
        configId: config.id,
      };
    })
    .filter(Boolean) as Array<{ provider: ShippingProvider; displayName: string; configId: string }>;

  if (configuredProviders.length) {
    return configuredProviders;
  }

  return registry.getAll().map((provider) => ({
    provider,
    displayName: provider.name,
    configId: provider.id,
  }));
}

export default shippingMethodsWebhook.createHandler(async (req, res, ctx) => {
  try {
    const payload = ctx.payload;

    const pincode = payload.checkout?.shippingAddress?.postalCode?.trim() || "";
    if (!pincode) {
      return res.status(200).json([]);
    }

    const rateRequest: RateRequest = {
      weight: getTotalCheckoutWeight(payload),
      country_code: payload.checkout?.shippingAddress?.country?.code || "IN",
      pincode,
      city: payload.checkout?.shippingAddress?.city || undefined,
      total_price: payload.checkout?.totalPrice?.gross?.amount || 0,
      cod: true,
    };

    const configuredProviders = getConfiguredProviders(ctx.authData.saleorApiUrl);

    const rateResults = await Promise.allSettled(
      configuredProviders.map((entry) => entry.provider.getRates(rateRequest))
    );

    const shippingMethods: Array<{
      id: string;
      name: string;
      amount: number;
      currency: string;
      maximum_delivery_days?: number;
    }> = [];

    rateResults.forEach((result, index) => {
      const providerEntry = configuredProviders[index];

      if (result.status !== "fulfilled") {
        console.error(`[ShippingMethods] Provider ${providerEntry.displayName} failed:`, result.reason);
        return;
      }

      for (const rate of result.value) {
        shippingMethods.push({
          id: `${providerEntry.configId}:${rate.id}`,
          name: `${providerEntry.displayName} - ${rate.name}`,
          amount: Number(rate.amount),
          currency: rate.currency,
          ...(rate.estimated_days ? { maximum_delivery_days: rate.estimated_days } : {}),
        });
      }
    });

    return res.status(200).json(shippingMethods);
  } catch (error) {
    console.error("[ShippingMethods] Failed to calculate shipping methods:", error);
    return res.status(200).json([]);
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
