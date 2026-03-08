import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type LlmConfigInfoBannerProps = {
  title: string;
  body: ReactNode;
  icon: LucideIcon;
  trailingIcon?: LucideIcon;
  className?: string;
};

export function LlmConfigInfoBanner({
  title,
  body,
  icon: Icon,
  trailingIcon: TrailingIcon,
  className,
}: LlmConfigInfoBannerProps): React.JSX.Element {
  return (
    <Card className={cn("border-sky-500/30 bg-sky-500/10", className)}>
      <CardContent className="flex items-start gap-3 py-4">
        <Icon className="mt-0.5 h-4 w-4 flex-none text-sky-600 dark:text-sky-300" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{body}</p>
        </div>
        {TrailingIcon ? (
          <TrailingIcon className="ml-auto mt-0.5 h-4 w-4 flex-none text-sky-500/80 dark:text-sky-300/80" />
        ) : null}
      </CardContent>
    </Card>
  );
}
