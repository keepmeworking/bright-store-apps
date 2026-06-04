type ExportInvoice = {
  url?: string | null;
  externalUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

const toTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const resolveLastInvoiceUrl = (
  invoices: ReadonlyArray<ExportInvoice> | null | undefined,
): string => {
  if (!invoices?.length) {
    return "";
  }

  const ranked = invoices
    .map((invoice) => ({
      url: (invoice.url || invoice.externalUrl || "").trim(),
      createdAt: toTimestamp(invoice.createdAt),
      updatedAt: toTimestamp(invoice.updatedAt),
    }))
    .filter((invoice) => invoice.url);

  if (ranked.length === 0) {
    return "";
  }

  ranked.sort((left, right) => {
    const createdDiff = right.createdAt - left.createdAt;
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return right.updatedAt - left.updatedAt;
  });

  return ranked[0].url;
};
