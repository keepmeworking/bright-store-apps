export type SellerAddress = {
  companyName: string;
  taxId?: string;
  email?: string;
  phone?: string;
  cityArea: string;
  countryArea: string;
  streetAddress1: string;
  streetAddress2: string;
  postalCode: string;
  city: string;
  country: string;
};

export const Address = {
  createEmpty(): SellerAddress {
    return {
      city: "",
      cityArea: "",
      companyName: "",
      country: "",
      countryArea: "",
      email: "",
      postalCode: "",
      phone: "",
      streetAddress1: "",
      streetAddress2: "",
      taxId: "",
    };
  },
};
