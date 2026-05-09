import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import packageJson from "@/package.json";
import { env } from "@/env";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl, request, schemaVersion }) {
    const apiBaseURL = env.APP_API_BASE_URL ?? appBaseUrl;
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;

    const normalizedApiBaseURL = apiBaseURL.replace(/\/$/, "");

    const manifest: AppManifest = {
      id: "shipping-aggregator.app",
      version: packageJson.version,
      name: "Shipping Aggregator",
      tokenTargetUrl: `${normalizedApiBaseURL}/api/register`,
      appUrl: iframeBaseUrl,
      permissions: [
        "MANAGE_ORDERS",
        "MANAGE_SHIPPING", 
      ],
      webhooks: [
        {
          name: "Calculate Shipping Rates",
          syncEvents: ["SHIPPING_LIST_METHODS_FOR_CHECKOUT"],
          query: `
            subscription {
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
                        currency
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
          `,
          targetUrl: `${normalizedApiBaseURL}/api/webhooks/shipping-methods`,
          isActive: true,
        },
        {
          name: "Order Created",
          asyncEvents: ["ORDER_CREATED", "ORDER_FULLY_PAID"],
          query: `
            subscription {
              event {
                ... on OrderCreated {
                  order {
                    id
                    number
                    userEmail
                    paymentStatus
                    shippingMethodName
                    shippingMethod {
                      id
                    }
                    metadata {
                      key
                      value
                    }
                    total {
                      gross {
                        amount
                        currency
                      }
                    }
                    shippingPrice {
                      gross {
                        amount
                        currency
                      }
                    }
                    shippingAddress {
                      streetAddress1
                      streetAddress2
                      city
                      countryArea
                      postalCode
                      country {
                        code
                      }
                      phone
                      firstName
                      lastName
                    }
                    lines {
                      productName
                      variantName
                      productSku
                      quantity
                      unitPrice {
                        gross {
                          amount
                        }
                      }
                      totalPrice {
                        gross {
                          amount
                        }
                      }
                      variant {
                        sku
                        weight {
                          value
                          unit
                        }
                      }
                    }
                  }
                }
                ... on OrderFullyPaid {
                  order {
                    id
                    number
                    userEmail
                    paymentStatus
                    shippingMethodName
                    shippingMethod {
                      id
                    }
                    metadata {
                      key
                      value
                    }
                    total {
                      gross {
                        amount
                        currency
                      }
                    }
                    shippingPrice {
                      gross {
                        amount
                        currency
                      }
                    }
                    shippingAddress {
                      streetAddress1
                      streetAddress2
                      city
                      countryArea
                      postalCode
                      country {
                        code
                      }
                      phone
                      firstName
                      lastName
                    }
                    lines {
                      productName
                      variantName
                      productSku
                      quantity
                      unitPrice {
                        gross {
                          amount
                        }
                      }
                      totalPrice {
                        gross {
                          amount
                        }
                      }
                      variant {
                        sku
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
          `,
          targetUrl: `${normalizedApiBaseURL}/api/webhooks/order-created`,
          isActive: true,
        },
      ],
      author: "Brightcode Canvas",
      brand: {
        logo: {
          default: `${normalizedApiBaseURL}/logo.png`,
        },
      },
    };

    return manifest;
  },
});
