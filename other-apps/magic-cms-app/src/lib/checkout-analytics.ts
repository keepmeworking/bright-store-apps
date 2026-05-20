export type CheckoutAnalyticsLike = {
  email?: string | null;
  quantity?: number | null;
  chargeStatus?: string | null;
  subtotalPrice?: {
    gross?: {
      amount?: number | null;
    } | null;
  } | null;
  billingAddress?: {
    phone?: string | null;
  } | null;
  shippingAddress?: {
    phone?: string | null;
  } | null;
};

export const hasCheckoutContact = (checkout: CheckoutAnalyticsLike) =>
  Boolean(checkout.email || checkout.billingAddress?.phone || checkout.shippingAddress?.phone);

export const isCompletedCheckout = (checkout: CheckoutAnalyticsLike) =>
  checkout.chargeStatus === "FULL" || checkout.chargeStatus === "OVERCHARGED";

export const hasCheckoutItems = (checkout: CheckoutAnalyticsLike) => (checkout.quantity || 0) > 0;

export const hasNonZeroSubtotal = (checkout: CheckoutAnalyticsLike) =>
  (checkout.subtotalPrice?.gross?.amount || 0) > 0;

export const isOpenCheckout = (checkout: CheckoutAnalyticsLike) =>
  hasCheckoutContact(checkout) && !isCompletedCheckout(checkout);

export const isRecoverableCart = (checkout: CheckoutAnalyticsLike) =>
  isOpenCheckout(checkout) && hasCheckoutItems(checkout) && hasNonZeroSubtotal(checkout);

export const isOpenLead = (checkout: CheckoutAnalyticsLike) =>
  isOpenCheckout(checkout) && !isRecoverableCart(checkout);
