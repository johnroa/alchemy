import type { RouteContext } from "../shared.ts";
import type { ChatDeps } from "./types.ts";
import { handleGreeting } from "./greeting.ts";
import { handleCreateSession, handleGetSession } from "./session.ts";
import { handleSendMessage } from "./message.ts";
import { handleCandidatePatch } from "./candidate.ts";
import { handleCommit } from "./commit.ts";

export type { ChatDeps } from "./types.ts";

/**
 * Top-level chat route dispatcher. Matches URL segments + HTTP method
 * and delegates to the appropriate sub-handler. Returns null when no
 * chat route matches so the caller can fall through to other route groups.
 */
export const handleChatRoutes = async (
  context: RouteContext,
  deps: ChatDeps,
): Promise<Response | null> => {
  const { segments, method } = context;

  // GET /chat/greeting
  if (
    segments.length === 2 &&
    segments[0] === "chat" &&
    segments[1] === "greeting" &&
    method === "GET"
  ) {
    return handleGreeting(context);
  }

  // POST /chat  (create session + first turn)
  if (segments.length === 1 && segments[0] === "chat" && method === "POST") {
    return handleCreateSession(context, deps);
  }

  // GET /chat/:id
  if (segments.length === 2 && segments[0] === "chat" && method === "GET") {
    return handleGetSession(context, deps);
  }

  // POST /chat/:id/messages
  if (
    segments.length === 3 &&
    segments[0] === "chat" &&
    segments[2] === "messages" &&
    method === "POST"
  ) {
    return handleSendMessage(context, deps);
  }

  // PATCH /chat/:id/candidate
  if (
    segments.length === 3 &&
    segments[0] === "chat" &&
    segments[2] === "candidate" &&
    method === "PATCH"
  ) {
    return handleCandidatePatch(context, deps);
  }

  // POST /chat/:id/commit
  if (
    segments.length === 3 &&
    segments[0] === "chat" &&
    segments[2] === "commit" &&
    method === "POST"
  ) {
    return handleCommit(context, deps);
  }

  return null;
};
