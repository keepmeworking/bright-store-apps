/**
 * Shipping Aggregator Settings API
 *
 * Manages per-provider configurations stored as a JSON list.
 *
 * GET  — Returns all provider configurations
 * POST — Add or update a provider configuration
 * DELETE — Remove a provider configuration by id
 */

import { type NextApiRequest, type NextApiResponse } from "next";
import { createProtectedHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import {
  getProviderConfigs,
  maskProviderCredentials,
  ProviderConfig,
  saveProviderConfigs,
} from "@/modules/provider-configs";

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: { authData: { saleorApiUrl: string } }
) {
  const saleorApiUrl = ctx?.authData?.saleorApiUrl || "";

  // GET — Return all configs (masked)
  if (req.method === "GET") {
    const configs = getProviderConfigs(saleorApiUrl);
    return res.status(200).json({
      configurations: configs.map(maskProviderCredentials),
    });
  }

  // POST — Add or update a provider configuration
  if (req.method === "POST") {
    try {
      const body = req.body as Partial<ProviderConfig> & {
        provider: string;
        name: string;
      };

      if (!body.provider || !body.name) {
        return res
          .status(400)
          .json({ error: "provider and name are required" });
      }

      const configs = getProviderConfigs(saleorApiUrl);
      const now = new Date().toISOString();

      if (body.id) {
        // Update existing
        const idx = configs.findIndex((c) => c.id === body.id);
        if (idx === -1) {
          return res.status(404).json({ error: "Configuration not found" });
        }

        // Merge credentials: keep existing for masked fields
        const existing = configs[idx];
        const mergedCreds = { ...existing.credentials };
        if (body.credentials) {
          for (const [key, val] of Object.entries(body.credentials)) {
            if (val && val !== "••••••••") {
              mergedCreds[key] = val;
            }
          }
        }

        configs[idx] = {
          ...existing,
          name: body.name,
          active: body.active ?? existing.active,
          credentials: mergedCreds,
          settings: body.settings
            ? { ...existing.settings, ...body.settings }
            : existing.settings,
          updatedAt: now,
        };

        saveProviderConfigs(saleorApiUrl, configs);
        return res.status(200).json({
          success: true,
          configuration: maskProviderCredentials(configs[idx]),
        });
      } else {
        // Create new
        const newConfig: ProviderConfig = {
          id: `${body.provider}-${Date.now()}`,
          provider: body.provider,
          name: body.name,
          active: body.active ?? true,
          credentials: body.credentials || {},
          settings: body.settings || {},
          createdAt: now,
          updatedAt: now,
        };

        configs.push(newConfig);
        saveProviderConfigs(saleorApiUrl, configs);
        return res.status(201).json({
          success: true,
          configuration: maskProviderCredentials(newConfig),
        });
      }
    } catch (error) {
      console.error("Failed to save configuration:", error);
      return res.status(500).json({ error: "Failed to save configuration" });
    }
  }

  // DELETE — Remove a configuration
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "id query param is required" });
    }

    const configs = getProviderConfigs(saleorApiUrl);
    const filtered = configs.filter((c) => c.id !== id);

    if (filtered.length === configs.length) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    saveProviderConfigs(saleorApiUrl, filtered);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default createProtectedHandler(handler, saleorApp.apl, ["MANAGE_SHIPPING"]);
