import { ApiError } from "./errors.ts";
import { createUserClient } from "./db.ts";

export type AuthContext = {
  userId: string;
  authHeader: string;
};

export const requireAuth = async (request: Request): Promise<AuthContext> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "Missing bearer token");
  }

  const client = createUserClient(authHeader);
  const { data, error } = await client.auth.getUser();

  if (error || !data.user?.id) {
    throw new ApiError(401, "unauthorized", "Token could not be validated");
  }

  return {
    userId: data.user.id,
    authHeader
  };
};
