import { NextResponse } from "next/server";
import { reviewDemandObservation } from "@/lib/admin-data";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export async function POST(request: Request): Promise<NextResponse> {
  const identity = await requireCloudflareAccess();
  const body = await request.json().catch(() => ({}));
  const observationId = typeof body.observation_id === "string" ? body.observation_id.trim() : "";
  const reviewStatus = body.review_status === "confirmed" || body.review_status === "rejected"
    ? body.review_status
    : null;
  const reviewNotes = typeof body.review_notes === "string" && body.review_notes.trim().length > 0
    ? body.review_notes.trim()
    : null;

  if (!observationId || !reviewStatus) {
    return NextResponse.json(
      { error: "observation_id and review_status are required" },
      { status: 400 },
    );
  }

  return NextResponse.json(await reviewDemandObservation({
    observationId,
    reviewStatus,
    reviewer: identity.email,
    reviewNotes,
  }));
}
