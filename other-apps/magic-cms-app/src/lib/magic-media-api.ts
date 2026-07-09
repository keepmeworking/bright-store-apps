import type { NextApiRequest } from "next";

export const parseBearerToken = (authorization?: string | string[]) => {
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization || "";
  if (!authHeader) return "";
  const authParts = authHeader.split(/\s+/);
  return authParts.length === 2 ? authParts[1] : authHeader;
};

export const requireMediaAuth = (req: NextApiRequest) => {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    const error = new Error("Missing authorization token");
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
  return token;
};

export const getErrorStatus = (error: unknown) => {
  if (error && typeof error === "object" && "statusCode" in error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (Number.isFinite(status) && status >= 400) return status;
  }
  return 500;
};

export const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};
