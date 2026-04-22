import fs from "fs";
import path from "path";

export interface ProviderConfig {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  credentials: Record<string, string>;
  settings: Record<string, string | boolean>;
  createdAt: string;
  updatedAt: string;
}

type ConfigStore = ProviderConfig[] | Record<string, ProviderConfig[]>;

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIGS_FILE = path.join(DATA_DIR, "provider-configs.json");
const DEFAULT_STORE_KEY = "default";

function readRawStore(): ConfigStore {
  try {
    if (!fs.existsSync(CONFIGS_FILE)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(CONFIGS_FILE, "utf-8"));
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    return parsed as ConfigStore;
  } catch (error) {
    console.error("Failed to read provider configs:", error);
    return [];
  }
}

function writeRawStore(store: Record<string, ProviderConfig[]>) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIGS_FILE, JSON.stringify(store, null, 2));
}

function normalizeStore(store: ConfigStore): Record<string, ProviderConfig[]> {
  if (Array.isArray(store)) {
    return {
      [DEFAULT_STORE_KEY]: store,
    };
  }

  const normalized: Record<string, ProviderConfig[]> = {};

  for (const [key, value] of Object.entries(store)) {
    normalized[key] = Array.isArray(value) ? value : [];
  }

  if (!Object.keys(normalized).length) {
    normalized[DEFAULT_STORE_KEY] = [];
  }

  return normalized;
}

function resolveStoreKey(saleorApiUrl?: string) {
  return saleorApiUrl || DEFAULT_STORE_KEY;
}

export function getProviderConfigs(saleorApiUrl?: string): ProviderConfig[] {
  const raw = readRawStore();

  if (Array.isArray(raw)) {
    return raw;
  }

  const key = resolveStoreKey(saleorApiUrl);
  if (Array.isArray(raw[key])) {
    return raw[key];
  }

  if (Array.isArray(raw[DEFAULT_STORE_KEY])) {
    return raw[DEFAULT_STORE_KEY];
  }

  return [];
}

export function saveProviderConfigs(saleorApiUrl: string | undefined, configs: ProviderConfig[]): void {
  const raw = readRawStore();
  const normalized = normalizeStore(raw);
  const key = resolveStoreKey(saleorApiUrl);

  normalized[key] = configs;

  writeRawStore(normalized);
}

export function maskProviderCredentials(config: ProviderConfig): ProviderConfig {
  const masked = { ...config, credentials: { ...config.credentials } };

  for (const key of Object.keys(masked.credentials)) {
    const value = masked.credentials[key];
    if (
      key.toLowerCase().includes("password") ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("token")
    ) {
      masked.credentials[key] = value ? "••••••••" : "";
    }
  }

  return masked;
}

export function resolveActiveProviderConfigs(saleorApiUrl?: string): ProviderConfig[] {
  return getProviderConfigs(saleorApiUrl).filter((config) => config.active);
}
