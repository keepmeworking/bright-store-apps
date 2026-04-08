import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Spinner, Text } from "@saleor/macaw-ui";
import { format, parseISO } from "date-fns";
import { AlertCircle, ArrowLeft, Mail, Phone, X } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import {
  type GetCheckoutDetailsQuery,
  type GetCheckoutsListQuery,
  useGetCheckoutDetailsQuery,
  useGetCheckoutsListQuery,
} from "../../../generated/graphql";
import { resolveRangeFromQuery, toDateQuery } from "@/lib/analytics-range";

type CheckoutListNode = NonNullable<NonNullable<GetCheckoutsListQuery["checkouts"]>["edges"][number]>["node"];
type CheckoutViewMode = "recoverable" | "leads";

const pageSize = 10;

const joinName = (...parts: Array<string | null | undefined>) =>
  parts
    .filter(Boolean)
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

const getCustomerName = (checkout: CheckoutListNode) =>
  (
    joinName(checkout.billingAddress?.firstName, checkout.billingAddress?.lastName) ||
    joinName(checkout.shippingAddress?.firstName, checkout.shippingAddress?.lastName)
  ).trim() || "Guest";

const getCustomerEmail = (checkout: CheckoutListNode) => checkout.email || "";

const getCustomerPhone = (checkout: CheckoutListNode) =>
  checkout.billingAddress?.phone || checkout.shippingAddress?.phone || "";

type CheckoutDetailsNode = NonNullable<GetCheckoutDetailsQuery["checkout"]>;

const getCustomerLocation = (checkout: CheckoutDetailsNode) =>
  [
    checkout.shippingAddress?.city || checkout.billingAddress?.city,
    checkout.shippingAddress?.country?.country || checkout.billingAddress?.country?.country,
  ]
    .filter(Boolean)
    .join(", ");

const hasCustomerContact = (checkout: CheckoutListNode) =>
  Boolean(getCustomerEmail(checkout) || getCustomerPhone(checkout));

const getLineCount = (checkout: CheckoutListNode) => checkout.quantity;

const isCompletedOnline = (checkout: CheckoutListNode) =>
  checkout.chargeStatus === "FULL" || checkout.chargeStatus === "OVERCHARGED";

const isRecoverableCart = (checkout: CheckoutListNode) =>
  hasCustomerContact(checkout) && getLineCount(checkout) > 0 && !isCompletedOnline(checkout);

const isOpenLead = (checkout: CheckoutListNode) => hasCustomerContact(checkout) && !isCompletedOnline(checkout) && !isRecoverableCart(checkout);

const isPermissionDeniedError = (message?: string) =>
  /need one of the following permissions|permission/i.test(message || "");

const getCheckoutProducts = (checkout: CheckoutDetailsNode) => {
  const productMap = new Map<string, { name: string; qty: number }>();

  checkout.lines.forEach((line) => {
    const productName = line.variant.product.name || line.variant.name || "Unnamed product";
    const current = productMap.get(productName) || { name: productName, qty: 0 };
    current.qty += line.quantity;
    productMap.set(productName, current);
  });

  return Array.from(productMap.values());
};

const toAddressLine = (checkout: CheckoutDetailsNode, type: "shipping" | "billing") => {
  const address = type === "shipping" ? checkout.shippingAddress : checkout.billingAddress;
  return [
    [address?.streetAddress1, address?.streetAddress2].filter(Boolean).join(", "),
    [address?.city, address?.postalCode].filter(Boolean).join(" "),
    address?.country?.country,
  ]
    .filter(Boolean)
    .join(", ");
};

export default function AnalyticsCheckoutsPage() {
  const router = useRouter();
  const { appBridgeState } = useAppBridge();
  const { channelId, start, end } = router.query;

  const resolvedRange = useMemo(() => resolveRangeFromQuery(start, end), [start, end]);
  const selectedChannelId = Array.isArray(channelId) ? channelId[0] : channelId || "";

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCheckoutId, setSelectedCheckoutId] = useState<string>("");
  const [viewMode, setViewMode] = useState<CheckoutViewMode>("recoverable");

  const [{ data, fetching, error }] = useGetCheckoutsListQuery({
    variables: {
      createdAfter: toDateQuery(resolvedRange.startDate),
      createdBefore: toDateQuery(resolvedRange.endDate),
      channels: selectedChannelId ? [selectedChannelId] : [],
      first: 100,
    },
    pause: !appBridgeState?.ready || !selectedChannelId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: selectedCheckoutData, fetching: selectedCheckoutFetching, error: selectedCheckoutError }] =
    useGetCheckoutDetailsQuery({
      variables: { id: selectedCheckoutId },
      pause: !appBridgeState?.ready || !selectedCheckoutId,
      requestPolicy: "cache-first",
    });

  const listRouteQuery = useMemo(
    () => ({
      channelId: selectedChannelId,
      start: toDateQuery(resolvedRange.startDate),
      end: toDateQuery(resolvedRange.endDate),
    }),
    [selectedChannelId, resolvedRange]
  );

  const allCheckouts = data?.checkouts?.edges.map((edge: NonNullable<GetCheckoutsListQuery["checkouts"]>["edges"][number]) => edge.node) || [];
  const recoverableCheckouts = useMemo(() => allCheckouts.filter(isRecoverableCart), [allCheckouts]);
  const openLeads = useMemo(() => allCheckouts.filter(isOpenLead), [allCheckouts]);
  const actionableCheckouts = viewMode === "recoverable" ? recoverableCheckouts : openLeads;
  const totalLeads = actionableCheckouts.length;
  const totalPages = Math.max(1, Math.ceil(totalLeads / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedChannelId, resolvedRange.startDate.getTime(), resolvedRange.endDate.getTime()]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedCheckoutId("");
  }, [viewMode]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const selectedCheckout = selectedCheckoutData?.checkout ?? null;

  const pagedCheckouts = useMemo(() => {
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize;
    return actionableCheckouts.slice(from, to);
  }, [actionableCheckouts, currentPage]);

  const visibleStart = totalLeads === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleEnd = Math.min(currentPage * pageSize, totalLeads);

  const visiblePages = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
  }, [currentPage, totalPages]);

  return (
    <Box padding={8} display="grid" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box display="grid" gap={1}>
          <Text as="h1" size={7} fontWeight="bold">
            {viewMode === "recoverable" ? "Recoverable Carts" : "Open Leads"} ({totalLeads})
          </Text>
          <Text color="default2" style={{ lineHeight: 1.35 }}>
            {format(resolvedRange.startDate, "dd MMM yyyy")} - {format(resolvedRange.endDate, "dd MMM yyyy")}
          </Text>
          <Text size={2} color="default2" marginTop={1} style={{ lineHeight: 1.35, maxWidth: 560 }}>
            {viewMode === "recoverable"
              ? "Only carts with contact details, items, and non-zero subtotal are shown here for active recovery."
              : "Leads with contact details but without a valid recoverable cart stay here for manual follow-up."}
          </Text>
        </Box>

        <Button variant="secondary" onClick={() => router.push({ pathname: "/analytics", query: listRouteQuery })}>
          <ArrowLeft size={16} /> Back to Analytics
        </Button>
      </Box>

      {fetching ? (
        <Box padding={10} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : error ? (
        <Box padding={8} borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4}>
          {isPermissionDeniedError(error.message) ? (
            <Box display="grid" gap={2}>
              <Box display="flex" gap={2} alignItems="center">
                <AlertCircle size={16} />
                <Text color="critical1" fontWeight="bold">
                  Checkout analytics need additional Saleor permissions
                </Text>
              </Box>
              <Text color="default2">
                The Magic CMS app can still load dashboard analytics, but the checkout recovery screens need refreshed
                app permissions in Saleor. Reinstall or refresh the app permissions after the manifest update, then try
                again.
              </Text>
            </Box>
          ) : (
            <Text color="critical1">Failed to load checkouts: {error.message}</Text>
          )}
        </Box>
      ) : pagedCheckouts.length === 0 ? (
        <Box padding={8} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
          <Text>
            {viewMode === "recoverable"
              ? "No recoverable carts found in the selected range."
              : "No open leads found in the selected range."}
          </Text>
        </Box>
      ) : (
        <Box
          borderStyle="solid"
          borderWidth={1}
          borderColor="default1"
          borderRadius={4}
          style={{ overflowX: "auto" }}
        >
          <Box style={{ minWidth: 920 }}>
            <Box
              padding={3}
              display="grid"
              __gridTemplateColumns="1.5fr 1fr 1fr 1fr 0.9fr"
              style={{ backgroundColor: "#f8f9fb", fontWeight: 700, gap: 10 }}
            >
              <Text size={2} fontWeight="bold">
                Checkout
              </Text>
              <Text size={2} fontWeight="bold">
                Customer
              </Text>
              <Text size={2} fontWeight="bold">
                Created
              </Text>
              <Text size={2} fontWeight="bold">
                Status
              </Text>
              <Text size={2} fontWeight="bold">
                Action
              </Text>
            </Box>

            {pagedCheckouts.map((checkout: CheckoutListNode) => {
              return (
                <Box
                  key={checkout.id}
                  padding={3}
                  display="grid"
                  __gridTemplateColumns="1.5fr 1fr 1fr 1fr 0.9fr"
                  borderTopStyle="solid"
                  borderTopWidth={1}
                  borderColor="default1"
                  alignItems="start"
                  style={{ gap: 10 }}
                >
                  <Box display="grid" gap={1}>
                    <Text
                      size={2}
                      fontWeight="bold"
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={checkout.token}
                    >
                      {checkout.token}
                    </Text>
                    <Text size={1} color="default2">
                      {getLineCount(checkout)} items
                    </Text>
                  </Box>

                  <Box display="grid" gap={1}>
                    <Text size={2} fontWeight="bold">
                      {getCustomerName(checkout)}
                    </Text>
                  </Box>

                  <Text size={2} color="default2">
                    {format(parseISO(checkout.created), "dd MMM yyyy, hh:mm a")}
                  </Text>

                  <Box display="grid" gap={1}>
                    <Text size={2} fontWeight="bold">
                      {checkout.chargeStatus}
                    </Text>
                    <Text size={1} color="default2">
                      Authorization: {checkout.authorizeStatus}
                    </Text>
                  </Box>

                  <Box display="grid" gap={2}>
                    <Button size="small" variant="secondary" onClick={() => setSelectedCheckoutId(checkout.id)}>
                      {viewMode === "recoverable" ? "Open cart" : "Open lead"}
                    </Button>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <Box
        display="flex"
        gap={2}
        alignItems="center"
        padding={3}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
      >
        <Button
          variant={viewMode === "recoverable" ? "primary" : "secondary"}
          onClick={() => setViewMode("recoverable")}
        >
          Recoverable Carts ({recoverableCheckouts.length})
        </Button>
        <Button
          variant={viewMode === "leads" ? "primary" : "secondary"}
          onClick={() => setViewMode("leads")}
        >
          Open Leads ({openLeads.length})
        </Button>
      </Box>

      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        padding={3}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
      >
        <Text size={2} color="default2">
          Showing {visibleStart}-{visibleEnd} of {totalLeads}
        </Text>
        <Box display="flex" gap={2} alignItems="center">
          <Button
            size="small"
            variant="secondary"
            disabled={currentPage <= 1 || fetching}
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </Button>

          {visiblePages.map((page) => (
            <Button
              key={page}
              size="small"
              variant={page === currentPage ? "primary" : "tertiary"}
              onClick={() => setCurrentPage(page)}
            >
              {page}
            </Button>
          ))}

          <Button
            size="small"
            variant="secondary"
            disabled={currentPage >= totalPages || fetching}
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </Button>
        </Box>
      </Box>

      {selectedCheckoutId ? (
        <Box
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 1200,
          }}
          onClick={() => setSelectedCheckoutId("")}
        >
          <Box
            borderRadius={4}
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: 780,
              maxHeight: "88vh",
              overflow: "auto",
              boxShadow: "0 18px 42px rgba(15,23,42,0.2)",
            }}
              onClick={(e) => e.stopPropagation()}
          >
            <Box
              padding={4}
              borderBottomStyle="solid"
              borderBottomWidth={1}
              borderColor="default1"
              display="flex"
              justifyContent="space-between"
              alignItems="start"
            >
              <Box display="grid" gap={1}>
                <Text as="h3" size={5} fontWeight="bold">
                  {viewMode === "recoverable" ? "Recoverable Cart Details" : "Lead Details"}
                </Text>
                <Text size={2} color="default2">
                    Checkout {selectedCheckout?.token || selectedCheckoutId}
                </Text>
              </Box>
              <Button variant="tertiary" size="small" onClick={() => setSelectedCheckoutId("")}>
                <X size={14} />
              </Button>
            </Box>

            <Box padding={4} display="grid" gap={4}>
              {selectedCheckoutFetching ? (
                <Box padding={8} display="flex" justifyContent="center">
                  <Spinner />
                </Box>
              ) : selectedCheckoutError ? (
                <Box padding={4} borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4}>
                  <Text color="critical1">Failed to load checkout details: {selectedCheckoutError.message}</Text>
                </Box>
              ) : !selectedCheckout ? (
                <Box padding={4} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
                  <Text>Checkout details not available.</Text>
                </Box>
              ) : (
                <>
              <Box display="grid" gap={1}>
                <Text size={1} color="default2">
                  Customer
                </Text>
                <Text size={3} fontWeight="bold">
                  {getCustomerName(selectedCheckout)}
                </Text>
                {getCustomerLocation(selectedCheckout) ? (
                  <Text size={2} color="default2">
                    {getCustomerLocation(selectedCheckout)}
                  </Text>
                ) : null}
              </Box>

              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={3}
                padding={3}
                display="grid"
                gap={2}
              >
                <Text size={2} fontWeight="bold">
                  Contact
                </Text>
                {getCustomerEmail(selectedCheckout) ? (
                  <a href={`mailto:${getCustomerEmail(selectedCheckout)}`} style={{ color: "#0f2940", fontSize: 14 }}>
                    <Mail size={14} style={{ verticalAlign: "middle" }} /> {getCustomerEmail(selectedCheckout)}
                  </a>
                ) : null}
                {getCustomerPhone(selectedCheckout) ? (
                  <a href={`tel:${getCustomerPhone(selectedCheckout)}`} style={{ color: "#0f2940", fontSize: 14 }}>
                    <Phone size={14} style={{ verticalAlign: "middle" }} /> {getCustomerPhone(selectedCheckout)}
                  </a>
                ) : null}
              </Box>

              <Box display="grid" gap={3} __gridTemplateColumns="1fr 1fr">
                {toAddressLine(selectedCheckout, "shipping") ? (
                  <Box
                    borderStyle="solid"
                    borderWidth={1}
                    borderColor="default1"
                    borderRadius={3}
                    padding={3}
                    display="grid"
                    gap={1}
                  >
                    <Text size={2} fontWeight="bold">
                      Shipping address
                    </Text>
                    <Text size={2}>{toAddressLine(selectedCheckout, "shipping")}</Text>
                  </Box>
                ) : null}

                {toAddressLine(selectedCheckout, "billing") ? (
                  <Box
                    borderStyle="solid"
                    borderWidth={1}
                    borderColor="default1"
                    borderRadius={3}
                    padding={3}
                    display="grid"
                    gap={1}
                  >
                    <Text size={2} fontWeight="bold">
                      Billing address
                    </Text>
                  <Text size={2}>{toAddressLine(selectedCheckout, "billing")}</Text>
                  </Box>
                ) : null}
              </Box>

              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={3}
                padding={3}
                display="grid"
                gap={2}
              >
                <Text size={2} fontWeight="bold">
                  Products in checkout
                </Text>
                {getCheckoutProducts(selectedCheckout).map((product) => (
                  <Box
                    key={`${selectedCheckout.id}-${product.name}-modal`}
                    display="grid"
                    __gridTemplateColumns="1fr auto"
                    alignItems="center"
                    style={{ columnGap: 12 }}
                  >
                    <Text size={2} style={{ lineHeight: 1.35 }}>
                      {product.name}
                    </Text>
                    <Box
                      aria-disabled="true"
                      style={{
                        minWidth: 44,
                        height: 28,
                        border: "1px solid #dbe1ea",
                        borderRadius: 8,
                        background: "#f8fafc",
                        color: "#6b7280",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "not-allowed",
                      }}
                    >
                      {product.qty}
                    </Box>
                  </Box>
                ))}
              </Box>

              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={3}
                padding={3}
                display="grid"
                gap={1}
              >
                <Text size={2} fontWeight="bold">
                  Checkout summary
                </Text>
                <Text size={2}>
                  Created: {format(parseISO(selectedCheckout.created), "dd MMM yyyy, hh:mm a")}
                </Text>
                <Text size={2}>Items: {getLineCount(selectedCheckout)}</Text>
                <Text size={2}>Charge status: {selectedCheckout.chargeStatus}</Text>
                <Text size={2}>Authorization status: {selectedCheckout.authorizeStatus}</Text>
                <Text size={2}>
                  Classification: {isRecoverableCart(selectedCheckout) ? "Recoverable cart" : "Open lead"}
                </Text>
              </Box>
                </>
              )}
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
