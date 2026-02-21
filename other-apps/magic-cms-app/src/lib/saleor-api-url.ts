export const normalizeSaleorApiUrl = (rawUrl: string) => {
  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) {
    return "";
  }

  if (trimmedUrl.endsWith("/graphql/")) {
    return trimmedUrl;
  }

  if (trimmedUrl.endsWith("/graphql")) {
    return `${trimmedUrl}/`;
  }

  if (trimmedUrl.endsWith("/")) {
    return `${trimmedUrl}graphql/`;
  }

  return `${trimmedUrl}/graphql/`;
};
