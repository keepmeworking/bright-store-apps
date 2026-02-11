import Microinvoice from "microinvoice";
import { OrderPayloadFragment } from "../../../../../generated/graphql";
import { AddressV2Shape } from "../../../app-configuration/schema-v2/app-config-schema.v2";
import { InvoiceGenerator } from "../invoice-generator";

export class MicroinvoiceInvoiceGenerator implements InvoiceGenerator {
  constructor(
    private settings = {
      locale: "en-US",
    },
  ) {}
  async generate(input: {
    order: OrderPayloadFragment;
    invoiceNumber: string;
    filename: string;
    companyAddressData: AddressV2Shape;
  }): Promise<void> {
    const { invoiceNumber, order, companyAddressData, filename } = input;

    const microinvoiceInstance = new Microinvoice({
      style: {
        /*
         * header: {
         *   image: {
         *     path: "./examples/logo.png",
         *     width: 50,
         *     height: 19,
         *   },
         * },
         */
      },
      data: {
        invoice: {
          name: `Invoice ${invoiceNumber}`,

          header: [
            {
              label: "Order number",
              value: order.number,
            },
            {
              label: "Date",
              value: Intl.DateTimeFormat(this.settings.locale, {
                dateStyle: "medium",
                timeStyle: "medium",
              }).format(new Date(order.created)),
            },
          ],

          currency: order.total?.currency ?? "USD",

          customer: [
            {
              label: "Customer",
              value: [
                `${order.billingAddress?.firstName ?? ""} ${order.billingAddress?.lastName ?? ""}`.trim(),
                order.billingAddress?.companyName ?? "",
                order.billingAddress?.phone ?? "",
                `${order.billingAddress?.streetAddress1 ?? ""}`,
                `${order.billingAddress?.streetAddress2 ?? ""}`,
                `${order.billingAddress?.postalCode ?? ""} ${order.billingAddress?.city ?? ""}`.trim(),
                order.billingAddress?.country?.country ?? "",
              ],
            },
            /*
             * {
             *   label: "Tax Identifier",
             *   value: "todo",
             * },
             */
          ],

          seller: [
            {
              label: "Seller",
              value: [
                companyAddressData.companyName ?? "",
                companyAddressData.streetAddress1 ?? "",
                companyAddressData.streetAddress2 ?? "",
                `${companyAddressData.postalCode ?? ""} ${companyAddressData.city ?? ""}`.trim(),
                companyAddressData.cityArea ?? "",
                companyAddressData.country ?? "",
                companyAddressData.countryArea ?? "",
              ],
            },
          ],
 
          legal: [],

          details: {
            header: [
              {
                value: "Description",
              },
              {
                value: "Quantity",
              },
              {
                value: "Subtotal",
              },
            ],

            parts: [
              ...(order.lines ?? []).map((line) => {
                return [
                  {
                    value: line.productName,
                  },
                  {
                    value: line.quantity,
                  },
                  {
                    value: line.totalPrice?.gross?.amount ?? 0,
                    price: true,
                  },
                ];
              }),
              [
                {
                  value: order.shippingMethodName ?? "Shipping",
                },
                {
                  value: "-",
                },
                {
                  value: order.shippingPrice?.gross?.amount ?? 0,
                  price: true,
                },
              ],
            ],

            total: [
              {
                label: "Total net",
                value: order.total?.net?.amount ?? 0,
                price: true,
              },
              {
                label: "Tax value",
                value: order.total?.tax?.amount ?? 0,
                price: true,
              },
              {
                label: "Total with tax",
                value: order.total?.gross?.amount ?? 0,
                price: true,
              },
            ],
          },
        },
      },
    });

    return microinvoiceInstance.generate(filename);
  }
}
