import { NextJsWebhookHandler, SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { wrapWithLoggerContext } from "@saleor/apps-logger/node";
import { ObservabilityAttributes } from "@saleor/apps-otel/src/observability-attributes";
import { withSpanAttributes } from "@saleor/apps-otel/src/with-span-attributes";
import { captureException } from "@sentry/nextjs";
import { gql } from "urql";

import {
  FulfillmentTrackingNumberUpdatedWebhookPayloadFragment,
  OrderDetailsFragmentDoc,
} from "../../../../generated/graphql";
import { createLogger } from "../../../logger";
import { loggerContext } from "../../../logger-context";
import { SendEventMessagesUseCase } from "../../../modules/event-handlers/use-case/send-event-messages.use-case";
import { SendEventMessagesUseCaseFactory } from "../../../modules/event-handlers/use-case/send-event-messages.use-case.factory";
import { saleorApp } from "../../../saleor-app";

const FulfillmentTrackingNumberUpdatedWebhookPayload = gql`
  ${OrderDetailsFragmentDoc}
  fragment FulfillmentTrackingNumberUpdatedWebhookPayload on FulfillmentTrackingNumberUpdated {
    fulfillment {
      id
      trackingNumber
      status
    }
    order {
      ...OrderDetails
    }
  }
`;

const FulfillmentTrackingNumberUpdatedGraphqlSubscription = gql`
  ${FulfillmentTrackingNumberUpdatedWebhookPayload}
  subscription FulfillmentTrackingNumberUpdated {
    event {
      ...FulfillmentTrackingNumberUpdatedWebhookPayload
    }
  }
`;

export const fulfillmentTrackingNumberUpdatedWebhook =
  new SaleorAsyncWebhook<FulfillmentTrackingNumberUpdatedWebhookPayloadFragment>({
    name: "Fulfillment Tracking Number Updated in Saleor",
    webhookPath: "api/webhooks/fulfillment-tracking-number-updated",
    event: "FULFILLMENT_TRACKING_NUMBER_UPDATED",
    apl: saleorApp.apl,
    query: FulfillmentTrackingNumberUpdatedGraphqlSubscription,
  });

const logger = createLogger(fulfillmentTrackingNumberUpdatedWebhook.webhookPath);

const useCaseFactory = new SendEventMessagesUseCaseFactory();

const buildFulfillmentUpdatePayload = ({
  order,
  fulfillment,
  recipientEmail,
}: {
  order: NonNullable<FulfillmentTrackingNumberUpdatedWebhookPayloadFragment["order"]>;
  fulfillment: NonNullable<FulfillmentTrackingNumberUpdatedWebhookPayloadFragment["fulfillment"]>;
  recipientEmail: string;
}) => ({
  fulfillment: {
    tracking_number: fulfillment.trackingNumber || "",
    is_tracking_number_url: false,
  },
  order: {
    number: order.number,
    billing_address: order.billingAddress
      ? {
          street_address_1: order.billingAddress.streetAddress1,
          street_address_2: order.billingAddress.streetAddress2,
          city: order.billingAddress.city,
          postal_code: order.billingAddress.postalCode,
          country: order.billingAddress.country?.country,
        }
      : null,
    shipping_address: order.shippingAddress
      ? {
          street_address_1: order.shippingAddress.streetAddress1,
          street_address_2: order.shippingAddress.streetAddress2,
          city: order.shippingAddress.city,
          postal_code: order.shippingAddress.postalCode,
          country: order.shippingAddress.country?.country,
        }
      : null,
  },
  recipient_email: recipientEmail,
  channel_slug: order.channel.slug,
});

const handler: NextJsWebhookHandler<
  FulfillmentTrackingNumberUpdatedWebhookPayloadFragment
> = async (_req, res, context) => {
  logger.info("Webhook received");

  const { payload, authData } = context;
  const { order, fulfillment } = payload;

  if (!order || !fulfillment) {
    logger.error("Missing order or fulfillment in payload");

    return res.status(200).end();
  }

  const recipientEmail = order.userEmail || order.user?.email;

  if (!recipientEmail?.length) {
    logger.error(`The order ${order.number} had no email recipient set. Aborting.`);

    return res
      .status(200)
      .json({ error: "Email recipient has not been specified in the event payload." });
  }

  const channel = order.channel.slug;

  loggerContext.set(ObservabilityAttributes.CHANNEL_SLUG, channel);

  const useCase = useCaseFactory.createFromAuthData(authData);

  try {
    return useCase
      .sendEventMessages({
        channelSlug: channel,
        event: "ORDER_FULFILLMENT_UPDATE",
        payload: buildFulfillmentUpdatePayload({ order, fulfillment, recipientEmail }),
        recipientEmail,
        saleorApiUrl: authData.saleorApiUrl,
      })
      .then((result) =>
        result.match(
          () => {
            logger.info("Successfully sent fulfillment tracking email");

            return res.status(200).json({ message: "The event has been handled" });
          },
          (err) => {
            const errorInstance = err[0];

            if (errorInstance instanceof SendEventMessagesUseCase.ServerError) {
              logger.info("Failed to send email(s) [server error]", { error: err });

              return res.status(400).json({ message: "Failed to send email" });
            }

            if (errorInstance instanceof SendEventMessagesUseCase.ClientError) {
              logger.info("Failed to send email(s) [client error]", { error: err });

              return res.status(400).json({ message: "Failed to send email" });
            }

            if (errorInstance instanceof SendEventMessagesUseCase.NoOpError) {
              logger.info("Sending emails aborted [no op]", { error: err });

              return res.status(200).json({ message: "The event has been handled [no op]" });
            }

            logger.error("Failed to send email(s) [unhandled error]", { error: err });
            captureException(new Error("Unhandled useCase error", { cause: err }));

            return res.status(500).json({ message: "Failed to send email [unhandled]" });
          },
        ),
      );
  } catch (e) {
    logger.error("Unhandled error from useCase", { error: e });
    captureException(e);

    return res.status(500).json({ message: "Failed to execute webhook" });
  }
};

export default wrapWithLoggerContext(
  withSpanAttributes(fulfillmentTrackingNumberUpdatedWebhook.createHandler(handler)),
  loggerContext,
);

export const config = {
  api: {
    bodyParser: false,
  },
};
