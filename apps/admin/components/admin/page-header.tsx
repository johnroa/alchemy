import { type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex-none">{actions}</div> : null}
      </div>
      <Separator />
    </header>
  );
}
