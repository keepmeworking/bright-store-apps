import { SALEOR_API_URL_HEADER } from "@saleor/app-sdk/headers";
import {
  NextJsWebhookHandler,
  SaleorAsyncWebhook,
} from "@saleor/app-sdk/handlers/next";
import { createGraphQLClient } from "../../../lib/create-graphql-client";
import { gql } from "urql";
import {
  InvoiceRequestedPayloadFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "../../../saleor-app";
import { GenerateInvoiceService } from "../../../modules/invoices/generate-invoice.service";

import { createLogger } from "../../../logger";
import { loggerContext, wrapWithLoggerContext } from "../../../logger-context";
import { AppConfigV2 } from "../../../modules/app-configuration/schema-v2/app-config";

const OrderPayload = gql`
  fragment Address on Address {
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

  fragment Money on Money {
    amount
    currency
  }

  fragment TaxedMoney on TaxedMoney {
    currency
    gross {
      ...Money
    }
    net {
      ...Money
    }
    tax {
      ...Money
    }
  }

  fragment OrderPayload on Order {
    shippingPrice {
      ...TaxedMoney
    }
    shippingMethodName
    number

    id
    billingAddress {
      ...Address
    }
    created
    fulfillments {
      created
    }
    status
    number
    total {
      ...TaxedMoney
    }
    channel {
      slug
    }
    lines {
      productName
      variantName
      quantity
      totalPrice {
        ...TaxedMoney
      }
    }
    shippingPrice {
      ...TaxedMoney
    }
    shippingMethodName
  }
`;

export const InvoiceCreatedPayloadFragment = gql`
  ${OrderPayload}

  fragment InvoiceRequestedPayload on InvoiceRequested {
    invoice {
      id
    }
    order {
      ... on Order {
        ...OrderPayload
      }
    }
  }
`;

const InvoiceRequestedSubscription = gql`
  ${InvoiceCreatedPayloadFragment}

  subscription InvoiceRequested {
    event {
      ...InvoiceRequestedPayload
    }
  }
`;

const logger = createLogger("InvoiceRequestedAsyncWebhook");

export const invoiceRequestedWebhook =
  new SaleorAsyncWebhook<InvoiceRequestedPayloadFragment>({
    name: "Invoice requested",
    webhookPath: "api/webhooks/invoice-requested",
    event: "INVOICE_REQUESTED",
    apl: saleorApp.apl,
    query: InvoiceRequestedSubscription,
    onError(error, request) {
      const saleorApiUrl = request.headers[SALEOR_API_URL_HEADER] as string;

      logger.error("Error during webhook handling", { error, saleorApiUrl });
    },
  });
 
/**
 * TODO
 * Refactor - extract smaller pieces
 * Test
 * More logs
 * Extract service
 */
export const handler: NextJsWebhookHandler<
  InvoiceRequestedPayloadFragment
> = async (req, res, context) => {
  const { authData, payload, baseUrl } = context;

  loggerContext.set("saleorApiUrl", authData.saleorApiUrl);

  const order = payload.order;

  logger.info({ orderId: order.id }, "Received event INVOICE_REQUESTED");
  logger.debug(order, "Order from payload:");

  const orderId = order.id;
 
    const client = createGraphQLClient({
      saleorApiUrl: authData.saleorApiUrl,
      token: authData.token,
    });
 
    try {
      await new GenerateInvoiceService(client).generate(orderId);
    } catch (err) {
      logger.error(err, "Error generating invoice");
 
      return res.status(500).json({
        error: "Error generating invoice",
        details: (err as any)?.message,
      });
    }

  logger.info("Success");

  return res.status(200).end();
};

export default wrapWithLoggerContext(
  invoiceRequestedWebhook.createHandler(handler),
  loggerContext,
);

export const config = {
  api: {
    bodyParser: false,
  },
};
