import { type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

export function PageHeader({
  title,
  description,
  icon,
  actions
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon ? <span className="flex-none text-muted-foreground">{icon}</span> : null}
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 sm:flex-none sm:justify-end">{actions}</div> : null}
      </div>
      <Separator />
    </header>
  );
}
