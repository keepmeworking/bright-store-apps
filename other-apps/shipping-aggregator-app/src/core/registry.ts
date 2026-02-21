import { ShippingProvider } from "../providers/types";
import { ShiprocketProvider } from "../providers/shiprocket";

class ProviderRegistry {
  private providers: Map<string, ShippingProvider> = new Map();

  constructor() {
    // Register default providers
    this.register(new ShiprocketProvider());
  }

  register(provider: ShippingProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ShippingProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): ShippingProvider[] {
    return Array.from(this.providers.values());
  }
}

export const registry = new ProviderRegistry();
