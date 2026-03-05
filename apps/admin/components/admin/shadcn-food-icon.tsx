import { cn } from "@/lib/utils";
import {
  SHADCN_FOOD_ICONS,
  type ShadcnFoodIconId
} from "@/components/admin/generated/shadcn-food-icons.generated";

export type { ShadcnFoodIconId };

export const isShadcnFoodIconId = (iconId: string): iconId is ShadcnFoodIconId =>
  iconId in SHADCN_FOOD_ICONS;

export function ShadcnFoodIcon({
  iconId,
  className
}: {
  iconId: ShadcnFoodIconId;
  className?: string;
}): React.JSX.Element {
  const markup = SHADCN_FOOD_ICONS[iconId];

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 w-4 shrink-0 [&>svg]:h-full [&>svg]:w-full [&>svg]:shrink-0",
        className
      )}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
