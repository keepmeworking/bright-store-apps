import { Client, gql } from "urql";
import {
  OrderPayloadFragment,
} from "../../../generated/graphql";
import { AddressV2Shape } from "../app-configuration/schema-v2/app-config-schema.v2";
import { GetAppConfigurationV2Service } from "../app-configuration/schema-v2/get-app-configuration.v2.service";
import { InvoiceCreateNotifier } from "./invoice-create-notifier/invoice-create-notifier";
import { hashInvoiceFilename } from "./invoice-file-name/hash-invoice-filename";
import { resolveTempPdfFileLocation } from "./invoice-file-name/resolve-temp-pdf-file-location";
import { MicroinvoiceInvoiceGenerator } from "./invoice-generator/microinvoice/microinvoice-invoice-generator";
import {
  InvoiceNumberGenerationStrategy,
  InvoiceNumberGenerator,
} from "./invoice-number-generator/invoice-number-generator";
import { SaleorInvoiceUploader } from "./invoice-uploader/saleor-invoice-uploader";
import { ShopInfoFetcher } from "../shop-info/shop-info-fetcher";
import { shopInfoQueryToAddressShape } from "../shop-info/shop-info-query-to-address-shape";
import { AppConfigV2 } from "../app-configuration/schema-v2/app-config";
import { createLogger } from "../../logger";

const OrderQuery = gql`
  query GenerateInvoiceService_Order($id: ID!) {
    order(id: $id) {
      ...GenerateInvoiceService_OrderPayload
    }
  }

  fragment GenerateInvoiceService_Address on Address {
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

  fragment GenerateInvoiceService_Money on Money {
    amount
    currency
  }

  fragment GenerateInvoiceService_TaxedMoney on TaxedMoney {
    currency
    gross {
      ...GenerateInvoiceService_Money
    }
    net {
      ...GenerateInvoiceService_Money
    }
    tax {
      ...GenerateInvoiceService_Money
    }
  }

  fragment GenerateInvoiceService_OrderPayload on Order {
    shippingPrice {
      ...GenerateInvoiceService_TaxedMoney
    }
    shippingMethodName
    number

    id
    billingAddress {
      ...GenerateInvoiceService_Address
    }
    created
    fulfillments {
      created
    }
    status
    number
    total {
      ...GenerateInvoiceService_TaxedMoney
    }
    channel {
      slug
    }
    lines {
      productName
      variantName
      quantity
      totalPrice {
        ...GenerateInvoiceService_TaxedMoney
      }
    }
  }
`;

export class GenerateInvoiceService {
  private logger = createLogger("GenerateInvoiceService");
  private invoiceNumberGenerator = new InvoiceNumberGenerator();

  constructor(private client: Client) {}

  async generate(orderId: string) {
    this.logger.info({ orderId }, "Starting invoice generation");

    const orderResponse = await this.client
      .query(OrderQuery, { id: orderId })
      .toPromise();

    const order = orderResponse.data?.order;

    if (!order) {
      throw new Error("Order not found");
    }

    const invoiceName = this.invoiceNumberGenerator.generateFromOrder(
      order as OrderPayloadFragment,
      InvoiceNumberGenerationStrategy.localizedDate("en-US"),
    );

    const hashedInvoiceName = hashInvoiceFilename(invoiceName, orderId);
    const hashedInvoiceFileName = `${hashedInvoiceName}.pdf`;
    const tempPdfLocation = await resolveTempPdfFileLocation(hashedInvoiceFileName);

    let appConfigV2 =
      (await new GetAppConfigurationV2Service({
        saleorApiUrl: "", // Not used in getConfiguration
        apiClient: this.client,
      }).getConfiguration()) ?? new AppConfigV2();

    const address: AddressV2Shape | null =
      appConfigV2.getChannelsOverrides()[order.channel.slug] ??
      (await new ShopInfoFetcher(this.client)
        .fetchShopInfo()
        .then(shopInfoQueryToAddressShape));

    if (!address) {
      throw new Error("App not configured - missing shop address");
    }

    await new MicroinvoiceInvoiceGenerator().generate({
      order: order as any,
      invoiceNumber: invoiceName,
      filename: tempPdfLocation,
      companyAddressData: address,
    });

    const uploader = new SaleorInvoiceUploader(this.client);
    const uploadedFileUrl = await uploader.upload(tempPdfLocation, `${invoiceName}.pdf`);

    await new InvoiceCreateNotifier(this.client).notifyInvoiceCreated(
      orderId,
      invoiceName,
      uploadedFileUrl,
    );

    return { invoiceName, uploadedFileUrl };
  }
}
