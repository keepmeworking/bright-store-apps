# Saleor Invoices App

A Saleor App that generates PDF invoices for orders using a webhook-based workflow.

## Features

-   **Auto-generation**: Automatically generates PDF invoices on `INVOICE_REQUESTED` events.
-   **File Storage**: Uploads generated PDFs to Saleor's file storage.
-   **Email Notification**: Triggers Saleor to send the invoice via email to the customer.
-   ** Customizable Template**: Uses `microinvoice` for easy template customization.

## Setup & Installation

This app uses `pnpm` and requires Node.js (v18+ recommended).

### 1. Install Dependencies

```bash
pnpm install
```

> **Note:** This app requires exact versions of some dependencies to work with Next.js 15.
> - `@saleor/app-sdk`: `0.50.1`
> - `@vanilla-extract/css`: `catalog:` (Latest)
> - `pdfkit` fonts are handled via `copy-webpack-plugin`.

### 2. Environment Variables

Create a `.env` file in the root of `apps/invoices` or use the root `.env` if using a monorepo.

```env
# URL where this app is hosted (e.g. Tunnel URL for local dev)
APP_IFRAME_BASE_URL=https://your-tunnel-url.com
APP_API_BASE_URL=https://your-tunnel-url.com

# Saleor Environment (Auto-filled by Saleor CLI / Dashboard)
SALEOR_API_URL=https://your-saleor-instance.saleor.cloud/graphql/
```

## Development

To run the app locally with tunnelling (required for Webhooks):

```bash
# In the apps/invoices directory
pnpm dev
# OR from root
pnpm --filter invoices dev
```

The app will start on port `3000`.

### Tunnelling

Since this app relies on webhooks, you must expose your local server to the internet.

```bash
cloudflared tunnel --url http://localhost:3000
```

Update `APP_IFRAME_BASE_URL` and `APP_API_BASE_URL` with the tunnel URL.

## Configuration

1.  **Install App**: Go to Saleor Dashboard > Apps > Install App. Use your Manifest URL (e.g., `https://<tunnel>/api/manifest`).
2.  **Permissions**: The app requests `MANAGE_ORDERS` permission.
3.  **Channel Configuration**:
    -   Go to App Configuration.
    -   Select a Channel.
    -   Set the Shop Address (Seller Details) for that channel.

## Customization

### Editing the Invoice Template

The invoice PDF is generated using `microinvoice` and `pdfkit`. To customize the layout, text, or logo:

**File:** `src/modules/invoices/invoice-generator/microinvoice/microinvoice-invoice-generator.ts`

#### Adding a Logo

Comment out or add the `image` block in the `style.header` section:

```typescript
style: {
  header: {
    image: {
      path: "./public/logo.png", // Ensure file exists in public/
      width: 50,
      height: 19,
    },
  },
},
```

#### Changing Seller Details

Navigate to the `seller` array in the `data` object. You can hardcode values or map new fields from `companyAddressData`.

```typescript
seller: [
  {
    label: "Seller",
    value: [
      "My Custom Shop Name",
      companyAddressData.streetAddress1,
      // ...
    ],
  },
],
```

#### Adding Legal Text / Footer

Add objects to the `legal` array:

```typescript
legal: [
  {
    value: "Thank you for your business!",
    weight: "bold",
    color: "primary",
  },
],
```

## Troubleshooting

### "Error generating invoice" (HTTP 500)

-   **Cause**: Missing font files on the server.
-   **Fix**: Ensure `copy-webpack-plugin` is configured in `next.config.js` to copy `pdfkit` fonts to `.next/server/vendor-chunks/data`.

### Macaw UI Crashes / "SprinklesError"

-   **Cause**: Using deprecated tokens (`neutralPlain`) or invalid props (`size="small"`) from Macaw UI < 1.0.
-   **Fix**: Use numeric sizes (e.g., `size={2}`) and valid tokens (`default1`, `default2`) compatible with Macaw UI 1.3.1. Ensure `@vanilla-extract/css` is installed.

### Updates Not Visible in Dashboard

-   **Behavior**: Dashboard orders page does not auto-refresh when an invoice is generated via webhook.
-   **Solution**: Manually refresh the Order page in the Dashboard to see the newly generated invoice link.
