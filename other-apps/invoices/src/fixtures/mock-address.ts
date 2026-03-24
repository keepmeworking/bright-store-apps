import { SellerShopConfig } from "../modules/app-configuration/schema-v1/app-config-v1";

export const getMockAddress = (): SellerShopConfig["address"] => {
  return {
    city: "Ghaziabad",
    cityArea: "",
    companyName: "Daikcell India Pvt Ltd",
    country: "India",
    countryArea: "Uttar Pradesh",
    postalCode: "201001",
    streetAddress1: "Pillar No. 680, Plot No. 1, Morta Industrial Area",
    streetAddress2: "Meerut Road",
  };
};
