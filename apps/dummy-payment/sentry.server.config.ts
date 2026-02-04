import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.ENV,
  includeLocalVariables: true,
  integrations: [
    Sentry.localVariablesIntegration({
      captureAllExceptions: true,
    }),
    Sentry.extraErrorDataIntegration(),
  ],
});
