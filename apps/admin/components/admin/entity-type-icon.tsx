import { Carrot, ChefHat, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const entityTypeIconMap: Record<string, LucideIcon> = {
  ingredient: Carrot,
  recipe: ChefHat
};

export function EntityTypeIcon({
  entityType,
  className
}: {
  entityType: string;
  className?: string;
}): React.JSX.Element {
  const Icon = entityTypeIconMap[entityType] ?? Circle;
  return <Icon aria-hidden className={cn("h-4 w-4", className)} />;
}
