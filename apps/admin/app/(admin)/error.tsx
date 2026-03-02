"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { reset: () => void }): React.JSX.Element {
  return (
    <Alert variant="destructive">
      <AlertTitle>Admin data failed to load</AlertTitle>
      <AlertDescription className="mt-2">
        The page could not load the latest operational data.
        <div className="mt-3">
          <Button variant="secondary" onClick={reset}>
            Retry
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
