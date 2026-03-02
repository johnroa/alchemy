import { ApiError } from "./errors.ts";
import { createUserClient } from "./db.ts";

export type AuthContext = {
  userId: string;
  authHeader: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
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
    authHeader,
    email: data.user.email ?? null,
    fullName:
      typeof data.user.user_metadata?.full_name === "string"
        ? data.user.user_metadata.full_name
        : typeof data.user.user_metadata?.name === "string"
          ? data.user.user_metadata.name
          : null,
    avatarUrl:
      typeof data.user.user_metadata?.avatar_url === "string"
        ? data.user.user_metadata.avatar_url
        : null
  };
};
