import fs from "fs/promises";
import path from "path";
import { gql } from "urql";
import { createGraphQLClient } from "../lib/create-graphql-client";
import { AppConfigV2 } from "../modules/app-configuration/schema-v2/app-config";
import { GetAppConfigurationV2Service } from "../modules/app-configuration/schema-v2/get-app-configuration.v2.service";
import { MicroinvoiceInvoiceGenerator } from "../modules/invoices/invoice-generator/microinvoice/microinvoice-invoice-generator";
import { InvoiceNumberGenerationStrategy, InvoiceNumberGenerator } from "../modules/invoices/invoice-number-generator/invoice-number-generator";
import { ShopInfoFetcher } from "../modules/shop-info/shop-info-fetcher";
import { shopInfoQueryToAddressShape } from "../modules/shop-info/shop-info-query-to-address-shape";
import { OrderPayloadFragment } from "../../generated/graphql";

const OrderQuery = gql`
  query RealInvoiceOrder($id: ID!) {
    order(id: $id) {
      ...RealInvoiceOrderPayload
    }
  }

  fragment RealInvoiceAddress on Address {
    id
    country {
      country
      code
    }
    companyName
    cityArea
    countryArea
    streetAddress1
    streetAddress2
    postalCode
    phone
    firstName
    lastName
    city
  }

  fragment RealInvoiceMoney on Money {
    amount
    currency
  }

  fragment RealInvoiceTaxedMoney on TaxedMoney {
    currency
    gross {
      ...RealInvoiceMoney
    }
    net {
      ...RealInvoiceMoney
    }
    tax {
      ...RealInvoiceMoney
    }
  }

  fragment RealInvoiceOrderPayload on Order {
    shippingPrice {
      ...RealInvoiceTaxedMoney
    }
    shippingMethodName
    number
    id
    billingAddress {
      ...RealInvoiceAddress
    }
    shippingAddress {
      ...RealInvoiceAddress
    }
    created
    fulfillments {
      created
    }
    status
    total {
      ...RealInvoiceTaxedMoney
    }
    channel {
      slug
    }
    lines {
      productName
      variantName
      quantity
      totalPrice {
        ...RealInvoiceTaxedMoney
      }
    }
  }
`;

type AuthFile = {
  saleorApiUrl: string;
  token: string;
};

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function findFallbackOrderRef() {
  const tempDir = path.resolve(process.cwd(), "_temp");
  const entries = await fs.readdir(tempDir);
  const candidate = entries.find((entry) => entry.includes("T3JkZXI6"));

  if (!candidate) {
    throw new Error("No existing real invoice filename found in _temp to infer an order ref");
  }

  const match = candidate.match(/(T3JkZXI6[^_]+)/);
  if (!match) {
    throw new Error(`Could not extract order ref from filename: ${candidate}`);
  }

  return match[1];
}

async function main() {
  const saleorApiUrlFromEnv = process.env.SALEOR_API_URL;
  const saleorTokenFromEnv = process.env.SALEOR_APP_TOKEN;
  let auth: AuthFile;

  if (saleorApiUrlFromEnv && saleorTokenFromEnv) {
    auth = {
      saleorApiUrl: saleorApiUrlFromEnv,
      token: saleorTokenFromEnv,
    };
  } else {
    const authPath = path.resolve(process.cwd(), ".saleor-app-auth.json");
    const rawAuth = await fs.readFile(authPath, "utf8");
    auth = JSON.parse(rawAuth) as AuthFile;
  }

  const client = createGraphQLClient({
    saleorApiUrl: auth.saleorApiUrl,
    token: auth.token,
  });

  const orderRef = process.env.REAL_ORDER_REF || (await findFallbackOrderRef());
  const response = await client.query(OrderQuery, { id: orderRef }).toPromise();
  const order = response.data?.order as OrderPayloadFragment | null | undefined;

  if (!order) {
    throw new Error(`Order not found for ref: ${orderRef}`);
  }

  const config =
    (await new GetAppConfigurationV2Service({
      saleorApiUrl: auth.saleorApiUrl,
      apiClient: client,
    }).getConfiguration()) ?? new AppConfigV2();

  const companyAddress =
    config.getChannelsOverrides()[order.channel.slug] ??
    (await new ShopInfoFetcher(client).fetchShopInfo().then(shopInfoQueryToAddressShape));

  if (!companyAddress) {
    throw new Error("Unable to resolve seller/company address");
  }

  const invoiceNumber = new InvoiceNumberGenerator().generateFromOrder(
    order,
    InvoiceNumberGenerationStrategy.localizedDate("en-US"),
  );
  const outputDir = process.env.DUMMY_INVOICE_OUTPUT_DIR
    ? path.resolve(process.env.DUMMY_INVOICE_OUTPUT_DIR)
    : path.resolve(process.cwd(), "_temp");
  const outputPath = path.join(outputDir, `real-${sanitizeFilenamePart(order.number)}.pdf`);

  await fs.mkdir(outputDir, { recursive: true });

  await new MicroinvoiceInvoiceGenerator().generate({
    order,
    invoiceNumber,
    filename: outputPath,
    companyAddressData: companyAddress,
  });

  // eslint-disable-next-line no-console
  console.log(`Real invoice generated: ${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(`Order ref used: ${orderRef}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to generate real invoice", error);
  process.exit(1);
});
