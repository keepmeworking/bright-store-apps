import { NextApiRequest, NextApiResponse } from "next";
import { registry } from "@/core/registry";
import { resolveActiveProviderConfigs } from "@/modules/provider-configs";
import { updateOrderTrackingMetadata } from "@/modules/saleor-order-tracking";
import { ShiprocketProvider } from "@/providers/shiprocket";
import { OrderDetails, ShippingProvider } from "@/providers/types";

type OrderWebhookPayload = {
  order?: {
    id: string;
    number?: string | null;
    userEmail?: string | null;
    paymentStatus?: string | null;
    shippingMethodName?: string | null;
    metadata?: Array<{ key: string; value?: string | null }> | null;
    total?: {
      gross?: {
        amount?: number | null;
        currency?: string | null;
      } | null;
    } | null;
    shippingPrice?: {
      gross?: {
        amount?: number | null;
      } | null;
    } | null;
    shippingAddress?: {
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      streetAddress1?: string | null;
      streetAddress2?: string | null;
      city?: string | null;
      countryArea?: string | null;
      postalCode?: string | null;
      country?: {
        code?: string | null;
      } | null;
    } | null;
    lines?: Array<{
      productName?: string | null;
      variantName?: string | null;
      productSku?: string | null;
      quantity?: number | null;
      unitPrice?: {
        gross?: {
          amount?: number | null;
        } | null;
      } | null;
      totalPrice?: {
        gross?: {
          amount?: number | null;
        } | null;
      } | null;
      variant?: {
        sku?: string | null;
        weight?: {
          value?: number | null;
          unit?: string | null;
        } | null;
      } | null;
    }> | null;
  } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function pickString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveSaleorApiUrl(req: NextApiRequest) {
  const header = req.headers["saleor-api-url"] || req.headers["x-saleor-api-url"];

  if (Array.isArray(header)) {
    return header[0] || "";
  }

  return (header as string) || process.env.SALEOR_API_URL || process.env.NEXT_PUBLIC_SALEOR_API_URL || "";
}

function resolveWebhookPayload(body: unknown): OrderWebhookPayload | null {
  const root = asRecord(body);
  if (!root) {
    return null;
  }

  const eventNode = asRecord(root.event);
  if (eventNode?.order) {
    return eventNode as unknown as OrderWebhookPayload;
  }

  if (root.order) {
    return root as unknown as OrderWebhookPayload;
  }

  const payloadNode = asRecord(root.payload);
  if (payloadNode?.order) {
    return payloadNode as unknown as OrderWebhookPayload;
  }

  return null;
}

function normalizeWeight(weightValue?: number | null, weightUnit?: string | null) {
  if (typeof weightValue !== "number" || !Number.isFinite(weightValue)) {
    return undefined;
  }

  const unit = (weightUnit || "KG").toUpperCase();

  if (unit === "G") {
    return Number((weightValue / 1000).toFixed(3));
  }

  if (unit === "LB") {
    return Number((weightValue * 0.453592).toFixed(3));
  }

  if (unit === "OZ") {
    return Number((weightValue * 0.0283495).toFixed(3));
  }

  return Number(weightValue.toFixed(3));
}

function normalizePhone(phone?: string | null) {
  const normalized = (phone || "").trim();

  if (!normalized) {
    return "9999999999";
  }

  const digits = normalized.replace(/\D/g, "");

  if (!digits) {
    return "9999999999";
  }

  if (digits.length >= 10) {
    return digits.slice(-10);
  }

  return digits;
}

function toOrderDetails(payload: OrderWebhookPayload): OrderDetails | null {
  const order = payload.order;

  if (!order?.id) {
    return null;
  }

  const shippingAddress = order.shippingAddress;

  if (!shippingAddress?.streetAddress1 || !shippingAddress.city || !shippingAddress.postalCode) {
    return null;
  }

  const firstName = pickString(shippingAddress.firstName) || "Customer";
  const lastName = pickString(shippingAddress.lastName) || "";
  const fullName = `${firstName} ${lastName}`.trim();

  const lines = (order.lines || [])
    .filter((line) => line && typeof line.quantity === "number" && Number.isFinite(line.quantity) && line.quantity > 0)
    .map((line) => {
      const productName = pickString(line.productName) || "Product";
      const variantName = pickString(line.variantName);
      const name = variantName ? `${productName} - ${variantName}` : productName;

      return {
        name,
        quantity: Math.max(1, line.quantity || 1),
        sku: pickString(line.variant?.sku) || pickString(line.productSku) || `line-${Math.random().toString(16).slice(2, 10)}`,
        unit_price: line.unitPrice?.gross?.amount || undefined,
        total_price: line.totalPrice?.gross?.amount || undefined,
        weight: normalizeWeight(line.variant?.weight?.value, line.variant?.weight?.unit),
      };
    });

  if (!lines.length) {
    return null;
  }

  const paymentStatus = (order.paymentStatus || "").toUpperCase();
  const paymentMethod: "COD" | "Prepaid" = paymentStatus === "NOT_CHARGED" ? "COD" : "Prepaid";

  return {
    id: order.id,
    number: pickString(order.number),
    payment_method: paymentMethod,
    shipping_charges: order.shippingPrice?.gross?.amount || 0,
    total_price: order.total?.gross?.amount || undefined,
    currency: pickString(order.total?.gross?.currency) || "INR",
    shipping_address: {
      name: fullName,
      street1: shippingAddress.streetAddress1,
      street2: shippingAddress.streetAddress2 || undefined,
      city: shippingAddress.city,
      state: shippingAddress.countryArea || "NA",
      pincode: shippingAddress.postalCode,
      country: pickString(shippingAddress.country?.code) || "IN",
      phone: normalizePhone(shippingAddress.phone),
      email: pickString(order.userEmail) || "orders@local.invalid",
    },
    lines,
  };
}

function metadataArrayToMap(metadata: Array<{ key: string; value?: string | null }> | null | undefined) {
  const map = new Map<string, string>();

  for (const entry of metadata || []) {
    if (!entry?.key) {
      continue;
    }

    if (typeof entry.value === "string") {
      map.set(entry.key, entry.value);
    }
  }

  return map;
}

function getConfiguredProviders(saleorApiUrl: string): Array<{ provider: ShippingProvider; displayName: string }> {
  const activeConfigs = resolveActiveProviderConfigs(saleorApiUrl);

  const configuredProviders = activeConfigs
    .map((config) => {
      if (config.provider !== "shiprocket") {
        return null;
      }

      return {
        provider: new ShiprocketProvider({
          email: config.credentials.email ? String(config.credentials.email).trim() : undefined,
          password: config.credentials.password ? String(config.credentials.password) : undefined,
          pickupPincode:
            typeof config.settings.pickupPincode === "string" && config.settings.pickupPincode.trim()
              ? config.settings.pickupPincode.trim()
              : undefined,
          pickupLocation:
            typeof config.settings.pickupLocation === "string" && config.settings.pickupLocation.trim()
              ? config.settings.pickupLocation.trim()
              : undefined,
          enableCod: Boolean(config.settings.enableCod),
        }),
        displayName: config.name || "Shiprocket",
      };
    })
    .filter(Boolean) as Array<{ provider: ShippingProvider; displayName: string }>;

  if (configuredProviders.length) {
    return configuredProviders;
  }

  return registry.getAll().map((provider) => ({
    provider,
    displayName: provider.name,
  }));
}

function pickProviderForOrder(
  shippingMethodName: string,
  providers: Array<{ provider: ShippingProvider; displayName: string }>
) {
  if (!providers.length) {
    return null;
  }

  const normalizedShippingMethod = shippingMethodName.toLowerCase();

  const explicitMatch = providers.find((entry) => {
    const byName = normalizedShippingMethod.includes(entry.displayName.toLowerCase());
    const byProvider = normalizedShippingMethod.includes(entry.provider.name.toLowerCase());

    return byName || byProvider;
  });

  return explicitMatch || providers[0];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const saleorApiUrl = resolveSaleorApiUrl(req);

  try {
    const payload = resolveWebhookPayload(req.body);
    const order = payload?.order;

    if (!payload || !order?.id) {
      console.warn("[OrderCreated] Payload does not include order object");
      return res.status(200).json({ success: true, skipped: true });
    }

    const metadataMap = metadataArrayToMap(order.metadata);
    if (metadataMap.get("shiprocket_shipment_id") || metadataMap.get("shiprocket_tracking_number")) {
      console.log(`[OrderCreated] Shipment already linked for order ${order.id}; skipping`);
      return res.status(200).json({ success: true, skipped: true, reason: "already_processed" });
    }

    const mappedOrder = toOrderDetails(payload);
    if (!mappedOrder) {
      console.warn(`[OrderCreated] Missing required order fields for shipment creation: ${order.id}`);
      return res.status(200).json({ success: true, skipped: true, reason: "insufficient_order_data" });
    }

    const providerEntries = getConfiguredProviders(saleorApiUrl);
    const selectedProviderEntry = pickProviderForOrder(order.shippingMethodName || "", providerEntries);

    if (!selectedProviderEntry) {
      console.warn(`[OrderCreated] No shipping provider available for order ${order.id}`);
      return res.status(200).json({ success: true, skipped: true, reason: "provider_missing" });
    }

    const shipment = await selectedProviderEntry.provider.createShipment(mappedOrder);

    const metadataEntries = [
      { key: "shipping_provider", value: selectedProviderEntry.provider.id },
      { key: "shipping_provider_name", value: selectedProviderEntry.displayName },
      { key: "shiprocket_shipment_id", value: shipment.provider_shipment_id || shipment.id },
      { key: "shiprocket_order_id", value: shipment.provider_order_id || shipment.id },
      { key: "shiprocket_tracking_number", value: shipment.tracking_number },
      ...(shipment.tracking_url ? [{ key: "shiprocket_tracking_url", value: shipment.tracking_url }] : []),
    ];

    if (saleorApiUrl) {
      try {
        await updateOrderTrackingMetadata(
          saleorApiUrl,
          order.id,
          metadataEntries,
          `Shipment created in Shiprocket. Tracking: ${shipment.tracking_number}`
        );
      } catch (metadataError) {
        console.error(`[OrderCreated] Shipment created but metadata update failed for order ${order.id}:`, metadataError);
      }
    } else {
      console.warn(`[OrderCreated] Shipment created for ${order.id} but saleorApiUrl missing; metadata update skipped`);
    }

    return res.status(200).json({
      success: true,
      shipment,
    });
  } catch (error) {
    console.error("[OrderCreated] Shipment creation failed:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Shipment creation failed",
    });
  }
}
