import { OrderPayloadFragment, OrderStatus } from "../../generated/graphql";

export const mockOrder: OrderPayloadFragment = {
  channel: {
    slug: "default-channel",
  },
  shippingPrice: {
    currency: "INR",
    gross: {
      amount: 0,
      currency: "INR",
    },
    net: {
      amount: 0,
      currency: "INR",
    },
    tax: {
      amount: 0,
      currency: "INR",
    },
  },
  shippingMethodName: "Free Shipping",
  number: "DAI-3991",
  id: "T3JkZXI6OTFiZjM5ZDQtZjRiMC00M2QyLTgwMjEtZjVkMTMwNDVlMjkx",
  billingAddress: {
    id: "QWRkcmVzczoxNzE4Ng==",
    country: {
      country: "India",
      code: "IN",
    },
    companyName: "",
    cityArea: "",
    countryArea: "Delhi",
    streetAddress1: "House No. 55, Block A",
    streetAddress2: "Uttam Nagar",
    postalCode: "110059",
    phone: "+917703974407",
    firstName: "Gaurav",
    lastName: "Khokkar",
    city: "New Delhi",
  },
  shippingAddress: {
    id: "QWRkcmVzczoxNzE4Ny==",
    country: {
      country: "India",
      code: "IN",
    },
    companyName: "",
    cityArea: "",
    countryArea: "Delhi",
    streetAddress1: "H-55, Arya Samaj Road",
    streetAddress2: "Uttam Nagar",
    postalCode: "110059",
    phone: "+917703974407",
    firstName: "Gaurav",
    lastName: "Khokkar",
    city: "New Delhi",
  },
  created: "2022-12-02T15:05:56.637068+00:00",
  fulfillments: [],
  status: OrderStatus.Unfulfilled,
  total: {
    currency: "INR",
    gross: {
      amount: 49998,
      currency: "INR",
    },
    net: {
      amount: 42371.19,
      currency: "INR",
    },
    tax: {
      amount: 7626.81,
      currency: "INR",
    },
  },
  lines: [
    {
      productName:
        "daikcell 10 KVA Copper 90V-270V Single Phase Air Cooled Servo Voltage Corrector - 2 Year Repair Warranty",
      variantName: "Customize Size Available As per your requirement",
      quantity: 1,
      totalPrice: {
        currency: "INR",
        gross: {
          amount: 49998,
          currency: "INR",
        },
        net: {
          amount: 42371.19,
          currency: "INR",
        },
        tax: {
          amount: 7626.81,
          currency: "INR",
        },
      },
    },
  ],
};
