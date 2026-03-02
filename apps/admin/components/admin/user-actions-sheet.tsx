"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export function UserActionsSheet({ userId, email }: { userId: string; email: string | null }): React.JSX.Element {
  const [reason, setReason] = useState("Operational action from admin UI");

  const call = async (path: string): Promise<void> => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, reason })
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Action failed");
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Manage
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{email ?? userId}</SheetTitle>
          <SheetDescription>Operational controls for account and memory profile.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-[120px]" />
          <Button
            variant="destructive"
            className="w-full"
            onClick={async () => {
              try {
                await call("/api/admin/users/deactivate");
                toast.success("User deactivated");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Deactivate failed");
              }
            }}
          >
            Deactivate User
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              try {
                await call("/api/admin/users/reset-memory");
                toast.success("User memory reset");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Reset memory failed");
              }
            }}
          >
            Reset Memory
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
