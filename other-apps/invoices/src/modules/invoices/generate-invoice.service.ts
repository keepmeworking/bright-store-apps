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
    shippingAddress {
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
      metadata {
        key
        value
      }
      variant {
        attributes {
          attribute {
            slug
            name
          }
          values {
            slug
            name
            plainText
            boolean
          }
        }
      }
      totalPrice {
        ...GenerateInvoiceService_TaxedMoney
      }
    }
  }
`;

const OrdersByNumberQuery = gql`
  query GenerateInvoiceService_OrdersByNumber($numbers: [String!]) {
    orders(first: 1, filter: { numbers: $numbers }) {
      edges {
        node {
          ...GenerateInvoiceService_OrderPayloadByNumber
        }
      }
    }
  }

  fragment GenerateInvoiceService_AddressByNumber on Address {
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

  fragment GenerateInvoiceService_MoneyByNumber on Money {
    amount
    currency
  }

  fragment GenerateInvoiceService_TaxedMoneyByNumber on TaxedMoney {
    currency
    gross {
      ...GenerateInvoiceService_MoneyByNumber
    }
    net {
      ...GenerateInvoiceService_MoneyByNumber
    }
    tax {
      ...GenerateInvoiceService_MoneyByNumber
    }
  }

  fragment GenerateInvoiceService_OrderPayloadByNumber on Order {
    shippingPrice {
      ...GenerateInvoiceService_TaxedMoneyByNumber
    }
    shippingMethodName
    number

    id
    billingAddress {
      ...GenerateInvoiceService_AddressByNumber
    }
    shippingAddress {
      ...GenerateInvoiceService_AddressByNumber
    }
    created
    fulfillments {
      created
    }
    status
    number
    total {
      ...GenerateInvoiceService_TaxedMoneyByNumber
    }
    channel {
      slug
    }
    lines {
      productName
      variantName
      quantity
      metadata {
        key
        value
      }
      variant {
        attributes {
          attribute {
            slug
            name
          }
          values {
            slug
            name
            plainText
            boolean
          }
        }
      }
      totalPrice {
        ...GenerateInvoiceService_TaxedMoneyByNumber
      }
    }
  }
`;

const OrdersBySearchQuery = gql`
  query GenerateInvoiceService_OrdersBySearch($search: String!) {
    orders(first: 1, filter: { search: $search }) {
      edges {
        node {
          ...GenerateInvoiceService_OrderPayloadBySearch
        }
      }
    }
  }

  fragment GenerateInvoiceService_AddressBySearch on Address {
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

  fragment GenerateInvoiceService_MoneyBySearch on Money {
    amount
    currency
  }

  fragment GenerateInvoiceService_TaxedMoneyBySearch on TaxedMoney {
    currency
    gross {
      ...GenerateInvoiceService_MoneyBySearch
    }
    net {
      ...GenerateInvoiceService_MoneyBySearch
    }
    tax {
      ...GenerateInvoiceService_MoneyBySearch
    }
  }

  fragment GenerateInvoiceService_OrderPayloadBySearch on Order {
    shippingPrice {
      ...GenerateInvoiceService_TaxedMoneyBySearch
    }
    shippingMethodName
    number

    id
    billingAddress {
      ...GenerateInvoiceService_AddressBySearch
    }
    shippingAddress {
      ...GenerateInvoiceService_AddressBySearch
    }
    created
    fulfillments {
      created
    }
    status
    number
    total {
      ...GenerateInvoiceService_TaxedMoneyBySearch
    }
    channel {
      slug
    }
    lines {
      productName
      variantName
      quantity
      metadata {
        key
        value
      }
      variant {
        attributes {
          attribute {
            slug
            name
          }
          values {
            slug
            name
            plainText
            boolean
          }
        }
      }
      totalPrice {
        ...GenerateInvoiceService_TaxedMoneyBySearch
      }
    }
  }
`;

function normalizeOrderRef(orderRef: string) {
  return orderRef.replace(/^#/, "").trim();
}

export class GenerateInvoiceService {
  private logger = createLogger("GenerateInvoiceService");
  private invoiceNumberGenerator = new InvoiceNumberGenerator();

  constructor(private client: Client) {}

  private async resolveOrder(orderRef: string) {
    const normalized = normalizeOrderRef(orderRef);

    if (!normalized) {
      throw new Error("Missing order reference");
    }

    const byId = await this.client.query(OrderQuery, { id: normalized }).toPromise();
    const orderById = byId.data?.order;

    if (orderById) {
      this.logger.info({ orderRef, normalized }, "Resolved order using GraphQL ID lookup");
      return orderById;
    }

    const byNumber = await this.client
      .query(OrdersByNumberQuery, { numbers: [normalized] })
      .toPromise();
    const orderByNumber = byNumber.data?.orders?.edges?.[0]?.node;

    if (orderByNumber) {
      this.logger.info({ orderRef, normalized }, "Resolved order using order number lookup");
      return orderByNumber;
    }

    const bySearch = await this.client
      .query(OrdersBySearchQuery, { search: normalized })
      .toPromise();
    const orderBySearch = bySearch.data?.orders?.edges?.[0]?.node;

    if (orderBySearch) {
      this.logger.info({ orderRef, normalized }, "Resolved order using search lookup");
      return orderBySearch;
    }

    throw new Error(`Could not resolve order from dashboard reference: ${normalized}`);
  }

  async generate(orderRef: string) {
    this.logger.info({ orderRef }, "Starting invoice generation");

    const order = await this.resolveOrder(orderRef);

    const invoiceName = this.invoiceNumberGenerator.generateFromOrder(
      order as OrderPayloadFragment,
      InvoiceNumberGenerationStrategy.orderNumber(),
    );

    const hashedInvoiceName = hashInvoiceFilename(invoiceName, order.id);
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
      order.id,
      invoiceName,
      uploadedFileUrl,
    );

    return { invoiceName, uploadedFileUrl };
  }
}
