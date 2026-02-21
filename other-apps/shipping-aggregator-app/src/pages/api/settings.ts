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
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  provider: string; // "shiprocket" | "delhivery" | "fedex" etc.
  name: string; // user-given label e.g. "Production Shiprocket"
  active: boolean;
  credentials: Record<string, string>;
  settings: Record<string, string | boolean>;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIGS_FILE = path.join(DATA_DIR, "provider-configs.json");

function readConfigs(): ProviderConfig[] {
  try {
    if (fs.existsSync(CONFIGS_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIGS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to read configs:", e);
  }
  return [];
}

function writeConfigs(configs: ProviderConfig[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIGS_FILE, JSON.stringify(configs, null, 2));
}

function maskCredentials(config: ProviderConfig): ProviderConfig {
  const masked = { ...config, credentials: { ...config.credentials } };
  for (const key of Object.keys(masked.credentials)) {
    const val = masked.credentials[key];
    if (
      key.toLowerCase().includes("password") ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("token")
    ) {
      masked.credentials[key] = val ? "••••••••" : "";
    }
  }
  return masked;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: { authData: { saleorApiUrl: string } }
) {
  // GET — Return all configs (masked)
  if (req.method === "GET") {
    const configs = readConfigs();
    return res.status(200).json({
      configurations: configs.map(maskCredentials),
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

      const configs = readConfigs();
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

        writeConfigs(configs);
        return res.status(200).json({
          success: true,
          configuration: maskCredentials(configs[idx]),
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
        writeConfigs(configs);
        return res.status(201).json({
          success: true,
          configuration: maskCredentials(newConfig),
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

    const configs = readConfigs();
    const filtered = configs.filter((c) => c.id !== id);

    if (filtered.length === configs.length) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    writeConfigs(filtered);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default createProtectedHandler(handler, saleorApp.apl, ["MANAGE_APPS"]);
