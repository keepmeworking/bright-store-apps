import { SellerShopConfig } from "../modules/app-configuration/schema-v1/app-config-v1";

export const getMockAddress = (): SellerShopConfig["address"] => {
  return {
    city: "Ghaziabad",
    cityArea: "",
    companyName: "Daikcell India Pvt Ltd",
    country: "India",
    countryArea: "Uttar Pradesh",
    email: "support@daikcell.in",
    postalCode: "201001",
    phone: "+91 7703977407",
    streetAddress1: "Pillar No. 680, Plot No. 1, Morta Industrial Area",
    streetAddress2: "Meerut Road",
    taxId: "09AAECD1234A1Z5",
  };
};
