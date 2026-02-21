import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Spinner, Text } from "@saleor/macaw-ui";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { useRouter } from "next/router";
import { useMemo } from "react";

import { useGetCheckoutDetailsQuery } from "../../../../generated/graphql";
import { resolveRangeFromQuery, toDateQuery } from "@/lib/analytics-range";

const formatMoney = (amount?: number | null, currency?: string | null) =>
  `${currency || ""} ${(amount || 0).toFixed(2)}`.trim();

const joinName = (...parts: Array<string | null | undefined>) =>
  parts
    .filter(Boolean)
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

const toAddressLines = (address?: {
  streetAddress1?: string | null;
  streetAddress2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: { country: string; code: string } | null;
} | null) =>
  [
    [address?.streetAddress1, address?.streetAddress2].filter(Boolean).join(", "),
    [address?.city, address?.postalCode].filter(Boolean).join(" "),
    address?.country?.country,
  ].filter(Boolean);

export default function CheckoutDetailsPage() {
  const router = useRouter();
  const { appBridgeState } = useAppBridge();
  const { checkoutId, channelId, start, end } = router.query;

  const resolvedRange = useMemo(() => resolveRangeFromQuery(start, end), [start, end]);
  const checkoutNodeId = Array.isArray(checkoutId) ? checkoutId[0] : checkoutId || "";
  const selectedChannelId = Array.isArray(channelId) ? channelId[0] : channelId || "";

  const [{ data, fetching, error }] = useGetCheckoutDetailsQuery({
    variables: { id: checkoutNodeId },
    pause: !appBridgeState?.ready || !checkoutNodeId,
    requestPolicy: "network-only",
  });

  const checkout = data?.checkout;
  const customerName =
    joinName(checkout?.user?.firstName, checkout?.user?.lastName) ||
    joinName(checkout?.billingAddress?.firstName, checkout?.billingAddress?.lastName) ||
    joinName(checkout?.shippingAddress?.firstName, checkout?.shippingAddress?.lastName) ||
    "Guest";
  const customerEmail = checkout?.email || checkout?.user?.email || "";
  const customerPhone = checkout?.billingAddress?.phone || checkout?.shippingAddress?.phone || "";

  const routeQuery = useMemo(
    () => ({
      channelId: selectedChannelId,
      start: toDateQuery(resolvedRange.startDate),
      end: toDateQuery(resolvedRange.endDate),
    }),
    [selectedChannelId, resolvedRange]
  );

  return (
    <Box padding={8} display="grid" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Text as="h1" size={7} fontWeight="bold">
            Checkout Details
          </Text>
          <Text color="default2">Review customer and follow up for conversion.</Text>
        </Box>
        <Box display="flex" gap={2}>
          <Button
            variant="secondary"
            onClick={() => router.push({ pathname: "/analytics/checkouts", query: routeQuery })}
          >
            <ArrowLeft size={16} /> Back to Open Checkouts
          </Button>
          <Button variant="tertiary" onClick={() => router.push({ pathname: "/analytics", query: routeQuery })}>
            Back to Analytics
          </Button>
        </Box>
      </Box>

      {fetching ? (
        <Box padding={10} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : error ? (
        <Box padding={8} borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4}>
          <Text color="critical1">Failed to load checkout details: {error.message}</Text>
        </Box>
      ) : !checkout ? (
        <Box padding={8} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
          <Text>Checkout not found.</Text>
        </Box>
      ) : (
        <>
          <Box display="grid" gap={4} __gridTemplateColumns="1fr 1fr 1fr 1fr">
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
              <Text size={1} color="default2">
                Checkout token
              </Text>
              <Text size={2} fontWeight="bold">
                {checkout.token}
              </Text>
            </Box>
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
              <Text size={1} color="default2">
                Created
              </Text>
              <Text size={2} fontWeight="bold">
                {format(parseISO(checkout.created), "dd MMM yyyy, hh:mm a")}
              </Text>
            </Box>
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
              <Text size={1} color="default2">
                Items
              </Text>
              <Text size={2} fontWeight="bold">
                {checkout.quantity}
              </Text>
            </Box>
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
              <Text size={1} color="default2">
                Total
              </Text>
              <Text size={2} fontWeight="bold">
                {formatMoney(checkout.totalPrice?.gross?.amount, checkout.totalPrice?.gross?.currency)}
              </Text>
            </Box>
          </Box>

          <Box display="grid" gap={4} __gridTemplateColumns="1.1fr 1fr">
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
              <Text as="h3" size={4} fontWeight="bold">
                Customer
              </Text>
              <Box marginTop={3} display="grid" gap={2}>
                <Text size={2} fontWeight="bold">
                  {customerName}
                </Text>
                <Text size={2} color="default2">
                  Payment status: {checkout.chargeStatus}
                </Text>
                <Text size={2} color="default2">
                  Authorization: {checkout.authorizeStatus}
                </Text>
                {customerEmail ? (
                  <a
                    href={`mailto:${customerEmail}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#1f2937", fontSize: 14 }}
                  >
                    <Mail size={14} /> {customerEmail}
                  </a>
                ) : (
                  <Text size={2} color="default2">
                    Email not available
                  </Text>
                )}
                {customerPhone ? (
                  <Text size={2} color="default2">
                    <Phone size={14} style={{ verticalAlign: "middle" }} /> {customerPhone}
                  </Text>
                ) : null}
                {checkout.customerNote ? (
                  <Box
                    marginTop={2}
                    padding={3}
                    borderStyle="solid"
                    borderWidth={1}
                    borderColor="default1"
                    borderRadius={3}
                  >
                    <Text size={1} color="default2">
                      Customer note
                    </Text>
                    <Text size={2}>{checkout.customerNote}</Text>
                  </Box>
                ) : null}
              </Box>
            </Box>

            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
              <Text as="h3" size={4} fontWeight="bold">
                Addresses
              </Text>
              <Box marginTop={3} display="grid" gap={3}>
                <Box>
                  <Text size={2} fontWeight="bold">
                    Shipping
                  </Text>
                  {toAddressLines(checkout.shippingAddress).map((line) => (
                    <Text key={`shipping-${line}`} size={2} color="default2">
                      {line}
                    </Text>
                  ))}
                </Box>
                <Box>
                  <Text size={2} fontWeight="bold">
                    Billing
                  </Text>
                  {toAddressLines(checkout.billingAddress).map((line) => (
                    <Text key={`billing-${line}`} size={2} color="default2">
                      {line}
                    </Text>
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} overflow="hidden">
            <Box
              padding={3}
              display="grid"
              __gridTemplateColumns="2fr 1fr 1fr 1fr"
              style={{ backgroundColor: "#f8f9fb", fontWeight: 700, gap: 10 }}
            >
              <Text size={2} fontWeight="bold">
                Product
              </Text>
              <Text size={2} fontWeight="bold">
                Qty
              </Text>
              <Text size={2} fontWeight="bold">
                Unit
              </Text>
              <Text size={2} fontWeight="bold">
                Total
              </Text>
            </Box>

            {checkout.lines.map((line) => (
              <Box
                key={line.id}
                padding={3}
                display="grid"
                __gridTemplateColumns="2fr 1fr 1fr 1fr"
                borderTopStyle="solid"
                borderTopWidth={1}
                borderColor="default1"
                style={{ gap: 10 }}
              >
                <Box display="grid" gap={1}>
                  <Text size={2} fontWeight="bold">
                    {line.variant.product.name}
                  </Text>
                  <Text size={1} color="default2">
                    {line.variant.name} {line.variant.sku ? `(${line.variant.sku})` : ""}
                  </Text>
                </Box>
                <Text size={2}>{line.quantity}</Text>
                <Text size={2}>
                  {formatMoney(line.unitPrice?.gross?.amount, line.unitPrice?.gross?.currency)}
                </Text>
                <Text size={2} fontWeight="bold">
                  {formatMoney(line.totalPrice?.gross?.amount, line.totalPrice?.gross?.currency)}
                </Text>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
