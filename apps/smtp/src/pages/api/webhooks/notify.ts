import { NextJsWebhookHandler, SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { wrapWithLoggerContext } from "@saleor/apps-logger/node";
import { withSpanAttributes } from "@saleor/apps-otel/src/with-span-attributes";
import { captureException } from "@sentry/nextjs";

import { notifyEventMapping, NotifySubscriptionPayload } from "../../../lib/notify-event-types";
import { createLogger } from "../../../logger";
import { loggerContext } from "../../../logger-context";
import { SendEventMessagesUseCase } from "../../../modules/event-handlers/use-case/send-event-messages.use-case";
import { SendEventMessagesUseCaseFactory } from "../../../modules/event-handlers/use-case/send-event-messages.use-case.factory";
import { saleorApp } from "../../../saleor-app";

/*
 * The Notify webhook is triggered on multiple Saleor events.
 * Type of the message is determined by `notify_event` field in the payload.
 */

export const notifyWebhook = new SaleorAsyncWebhook<NotifySubscriptionPayload>({
  name: "notify",
  webhookPath: "api/webhooks/notify",
  event: "NOTIFY_USER",
  apl: saleorApp.apl,
  query: "{}", // We are using the default payload instead of subscription
});

const logger = createLogger(notifyWebhook.webhookPath);

const useCaseFactory = new SendEventMessagesUseCaseFactory();

const handler: NextJsWebhookHandler<NotifySubscriptionPayload> = async (_req, res, context) => {
  logger.info("Webhook received");

  const { payload, authData } = context;

  /*
   * Cast to a broad type so we can safely probe fallback fields that may exist at runtime
   * for events not in the NotifySubscriptionPayload union (e.g. order_confirmation sent by Saleor).
   */
  const rawPayload = payload.payload as unknown as {
    channel_slug?: string;
    recipient_email?: string;
    user?: { email?: string };
    order?: { email?: string };
  };

  const channel = rawPayload.channel_slug ?? "";
  const recipientEmail =
    rawPayload.recipient_email?.trim() ||
    rawPayload.user?.email?.trim() ||
    rawPayload.order?.email?.trim() ||
    "";

  /**
   * Since NOTIFY can be send on events unrelated to this app, lack of mapping means the App does not support it
   * Some events are not supported by the SMTP app, but we can still add them to the log context
   */
  const event = notifyEventMapping[payload.notify_event];

  loggerContext.set("event", event);

  if (!recipientEmail) {
    logger.info(`Skipping notify event — no recipient email found in payload.`, {
      notify_event: payload.notify_event,
    });

    return res.status(200).json({ message: "Skipped — no recipient email in payload." });
  }

  if (!event) {
    loggerContext.set("event", payload.notify_event);

    logger.info(`The type of received notify event (${payload.notify_event}) is not supported.`);

    return res.status(200).json({ message: `${payload.notify_event} event is not supported.` });
  }

  const useCase = useCaseFactory.createFromAuthData(authData);

  try {
    return useCase
      .sendEventMessages({
        channelSlug: channel,
        event,
        payload: payload.payload,
        recipientEmail,
        saleorApiUrl: authData.saleorApiUrl,
      })
      .then((result) =>
        result.match(
          (_r) => {
            logger.info("Successfully sent email(s)");

            return res.status(200).json({ message: "The event has been handled" });
          },
          (err) => {
            const errorInstance = err[0];

            if (errorInstance instanceof SendEventMessagesUseCase.ServerError) {
              logger.info("Failed to send email(s) [server error]", { error: err });

              return res.status(400).json({ message: "Failed to send email" });
            } else if (errorInstance instanceof SendEventMessagesUseCase.ClientError) {
              logger.info("Failed to send email(s) [client error]", { error: err });

              return res.status(400).json({ message: "Failed to send email" });
            } else if (errorInstance instanceof SendEventMessagesUseCase.NoOpError) {
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
    logger.error("Unhandled error from useCase", {
      error: e,
    });

    captureException(e);

    return res.status(500).json({ message: "Failed to execute webhook" });
  }
};

export default wrapWithLoggerContext(
  withSpanAttributes(notifyWebhook.createHandler(handler)),
  loggerContext,
);

export const config = {
  api: {
    bodyParser: false,
  },
};
