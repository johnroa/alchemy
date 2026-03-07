import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AnalyticsMovedNotice({
  title,
  description,
  href,
  cta = "Open analytics",
}: {
  title: string;
  description: string;
  href: string;
  cta?: string;
}): React.JSX.Element {
  return (
    <Alert className="border-primary/20 bg-primary/5">
      <BarChart3 className="h-4 w-4 text-primary" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={href} className="inline-flex items-center gap-1.5">
            {cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
