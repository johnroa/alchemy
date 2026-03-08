"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DemandTraceRow } from "@/lib/admin-data/demand";

export function DemandReviewQueue({
  rows,
}: {
  rows: DemandTraceRow[];
}): React.JSX.Element {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitReview = (observationId: string, reviewStatus: "confirmed" | "rejected"): void => {
    setPendingId(observationId);
    startTransition(async () => {
      const response = await fetch("/api/admin/demand/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          observation_id: observationId,
          review_status: reviewStatus,
        }),
      });

      if (response.ok) {
        router.refresh();
      }
      setPendingId(null);
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Stage</TableHead>
          <TableHead>Snippet</TableHead>
          <TableHead>Facts</TableHead>
          <TableHead className="text-right">Confidence</TableHead>
          <TableHead className="text-right">Review</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
              No sampled observations are waiting for review.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const disabled = isPending && pendingId === row.observation.id;
            return (
              <TableRow key={row.observation.id}>
                <TableCell>
                  <div className="space-y-1">
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {row.observation.stage}
                    </Badge>
                    <p className="font-mono text-[11px] text-muted-foreground">{row.observation.extractor_scope}</p>
                  </div>
                </TableCell>
                <TableCell className="max-w-[18rem] align-top text-sm text-muted-foreground">
                  {row.observation.admin_snippet_redacted ?? "Derived-only observation"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.facts.slice(0, 4).map((fact) => (
                      <Badge key={`${row.observation.id}-${fact.facet}-${fact.normalized_value}`} variant="outline" className="text-[10px]">
                        {fact.facet}: {fact.normalized_value}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(row.observation.confidence * 100).toFixed(0)}%
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => submitReview(row.observation.id, "rejected")}>
                      Reject
                    </Button>
                    <Button size="sm" disabled={disabled} onClick={() => submitReview(row.observation.id, "confirmed")}>
                      Confirm
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
