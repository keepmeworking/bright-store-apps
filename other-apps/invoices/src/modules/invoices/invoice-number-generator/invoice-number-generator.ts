import { OrderPayloadFragment } from "../../../../generated/graphql";

interface IInvoiceNumberGenerationStrategy {
  (order: OrderPayloadFragment): string;
}

const localizedDate = (locale: string) => (order: Pick<OrderPayloadFragment, "created">) => {
  const orderCreatedDate = new Date(order.created);

  return Intl.DateTimeFormat(locale).format(orderCreatedDate);
};

export const InvoiceNumberGenerationStrategy = {
  orderNumber: () => (order: Pick<OrderPayloadFragment, "number" | "created">) => {
    return order.number || localizedDate("en-US")(order);
  },
  localizedDate,
} satisfies Record<string, (...args: any[]) => IInvoiceNumberGenerationStrategy>;

export class InvoiceNumberGenerator {
  generateFromOrder(
    order: OrderPayloadFragment,
    strategy: IInvoiceNumberGenerationStrategy
  ): string {
    return strategy(order);
  }
}
