import {
  ArrowRightLeft,
  Carrot,
  ChefHat,
  CheckCircle2,
  Circle,
  Clock3,
  Globe2,
  HeartPulse,
  Microwave,
  PartyPopper,
  Snowflake,
  Target,
  UtensilsCrossed,
  Wallet,
  WandSparkles,
  XCircle,
  Users,
  type LucideIcon
} from "lucide-react";
import {
  ShadcnFoodIcon,
  isShadcnFoodIconId,
  type ShadcnFoodIconId
} from "@/components/admin/shadcn-food-icon";
import {
  resolveIngredientIconKey,
  type IngredientIconKey
} from "@alchemy/shared/ingredient-icon-key";
import { resolveIngredientSemanticIconId } from "@alchemy/shared/ingredient-semantic-icon";
import { cn } from "@/lib/utils";

const entityTypeIconMap: Record<string, { icon: LucideIcon; toneClass: string }> = {
  recipe: { icon: ChefHat, toneClass: "text-blue-600" },
  goal: { icon: Target, toneClass: "text-teal-700" },
  dish: { icon: UtensilsCrossed, toneClass: "text-blue-700" },
  cuisine: { icon: Globe2, toneClass: "text-violet-700" },
  ingredient_want: { icon: Carrot, toneClass: "text-emerald-700" },
  ingredient_avoid: { icon: XCircle, toneClass: "text-rose-700" },
  pantry_item: { icon: Carrot, toneClass: "text-green-700" },
  diet_constraint: { icon: XCircle, toneClass: "text-red-700" },
  health_goal: { icon: HeartPulse, toneClass: "text-orange-700" },
  time_budget: { icon: Clock3, toneClass: "text-amber-700" },
  budget_tier: { icon: Wallet, toneClass: "text-stone-700" },
  occasion: { icon: PartyPopper, toneClass: "text-fuchsia-700" },
  appliance: { icon: Microwave, toneClass: "text-cyan-700" },
  household_context: { icon: Users, toneClass: "text-indigo-700" },
  novelty_preference: { icon: WandSparkles, toneClass: "text-yellow-700" },
  requested_substitution: { icon: ArrowRightLeft, toneClass: "text-orange-700" },
  outcome: { icon: CheckCircle2, toneClass: "text-slate-700" }
};

type IngredientIcon = {
  toneClass: string;
  icon?: LucideIcon;
  shadcnIconId?: ShadcnFoodIconId;
};

const ingredientIconMap: Record<IngredientIconKey, IngredientIcon> = {
  seafood: { shadcnIconId: "openmoji-fish", toneClass: "text-sky-600" },
  shellfish: { shadcnIconId: "openmoji-shrimp", toneClass: "text-cyan-700" },
  poultry: { shadcnIconId: "openmoji-chicken", toneClass: "text-amber-700" },
  meat: { shadcnIconId: "openmoji-cut-of-meat", toneClass: "text-rose-700" },
  egg: { shadcnIconId: "openmoji-egg", toneClass: "text-yellow-700" },
  dairy: { shadcnIconId: "noto-glass-of-milk", toneClass: "text-blue-700" },
  oil: { shadcnIconId: "openmoji-olive", toneClass: "text-amber-600" },
  sweetener: { shadcnIconId: "openmoji-honey-pot", toneClass: "text-fuchsia-600" },
  spice: { shadcnIconId: "openmoji-hot-pepper", toneClass: "text-orange-600" },
  herb: { shadcnIconId: "openmoji-garlic", toneClass: "text-emerald-600" },
  sauce: { shadcnIconId: "openmoji-pot-of-food", toneClass: "text-orange-700" },
  grain: { shadcnIconId: "openmoji-bread", toneClass: "text-stone-700" },
  legume: { shadcnIconId: "openmoji-beans", toneClass: "text-green-700" },
  nut: { shadcnIconId: "openmoji-chestnut", toneClass: "text-amber-800" },
  fruit_apple: { shadcnIconId: "openmoji-apple", toneClass: "text-red-700" },
  fruit_citrus: { shadcnIconId: "openmoji-half-orange-fruit", toneClass: "text-orange-500" },
  fruit_berry: { shadcnIconId: "openmoji-blueberries", toneClass: "text-rose-600" },
  fruit_grape: { shadcnIconId: "openmoji-grapes", toneClass: "text-violet-700" },
  fruit_tropical: { shadcnIconId: "openmoji-mango", toneClass: "text-yellow-500" },
  vegetable_leafy: { shadcnIconId: "openmoji-green-salad", toneClass: "text-emerald-600" },
  vegetable_root: { shadcnIconId: "openmoji-carrot", toneClass: "text-orange-600" },
  vegetable_allium: { shadcnIconId: "openmoji-onion", toneClass: "text-lime-700" },
  vegetable_cruciferous: { shadcnIconId: "openmoji-broccoli", toneClass: "text-green-700" },
  vegetable: { shadcnIconId: "openmoji-cucumber", toneClass: "text-lime-700" },
  salad: { shadcnIconId: "openmoji-green-salad", toneClass: "text-emerald-600" },
  soup: { shadcnIconId: "openmoji-steaming-bowl", toneClass: "text-orange-600" },
  sandwich: { shadcnIconId: "openmoji-sandwich", toneClass: "text-amber-700" },
  pizza: { shadcnIconId: "openmoji-pizza", toneClass: "text-rose-700" },
  dessert: { shadcnIconId: "openmoji-cupcake", toneClass: "text-pink-600" },
  frozen_dessert: { shadcnIconId: "openmoji-ice-cream", toneClass: "text-cyan-600" },
  beverage_coffee: { shadcnIconId: "openmoji-hot-beverage", toneClass: "text-stone-700" },
  beverage_alcohol: { shadcnIconId: "openmoji-wine-glass", toneClass: "text-violet-700" },
  beverage_soft: { shadcnIconId: "openmoji-cup-with-straw", toneClass: "text-indigo-600" },
  vegan: { shadcnIconId: "openmoji-green-salad", toneClass: "text-emerald-700" },
  frozen: { icon: Snowflake, toneClass: "text-cyan-600" },
  baking: { shadcnIconId: "openmoji-cookie", toneClass: "text-amber-700" },
  generic: { icon: UtensilsCrossed, toneClass: "text-emerald-600" }
};

const isIngredientIconKey = (value: string): value is IngredientIconKey =>
  Object.prototype.hasOwnProperty.call(ingredientIconMap, value);

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (obj: Record<string, unknown> | null, key: string): string | null => {
  if (!obj) return null;
  const raw = obj[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveIngredientIconFromMetadata = (
  metadata: Record<string, unknown> | null | undefined
): IngredientIcon | null => {
  const meta = asObject(metadata ?? null);
  if (!meta) {
    return null;
  }

  const explicitIconId = readString(meta, "shadcn_icon_id") ??
    readString(meta, "semantic_icon_id") ??
    readString(meta, "icon_id");
  if (explicitIconId && isShadcnFoodIconId(explicitIconId)) {
    return {
      shadcnIconId: explicitIconId,
      toneClass: "text-emerald-600"
    };
  }

  const explicitIconKey = (readString(meta, "icon_key") ??
    readString(meta, "semantic_icon_key"))?.toLocaleLowerCase();
  if (explicitIconKey && isIngredientIconKey(explicitIconKey)) {
    return ingredientIconMap[explicitIconKey];
  }

  return null;
};

export function EntityTypeIcon({
  entityType,
  canonicalName,
  normalizedKey,
  metadata,
  className
}: {
  entityType: string;
  canonicalName?: string | null;
  normalizedKey?: string | null;
  metadata?: Record<string, unknown> | null;
  className?: string;
}): React.JSX.Element {
  if (entityType === "ingredient") {
    const hasSemanticContext = Boolean(
      (canonicalName && canonicalName.trim().length > 0) ||
      (normalizedKey && normalizedKey.trim().length > 0) ||
      (metadata && Object.keys(metadata).length > 0)
    );

    if (!hasSemanticContext) {
      return <Carrot aria-hidden className={cn("h-4 w-4 text-emerald-600", className)} />;
    }

    const iconInput = {
      canonicalName: canonicalName ?? null,
      normalizedKey: normalizedKey ?? null,
      metadata: metadata ?? null
    };
    const metadataIcon = resolveIngredientIconFromMetadata(metadata);
    if (metadataIcon) {
      if (metadataIcon.shadcnIconId) {
        return (
          <ShadcnFoodIcon
            iconId={metadataIcon.shadcnIconId}
            className={cn("h-4 w-4", metadataIcon.toneClass, className)}
          />
        );
      }

      const Icon = metadataIcon.icon ?? UtensilsCrossed;
      return <Icon aria-hidden className={cn("h-4 w-4", metadataIcon.toneClass, className)} />;
    }

    const semanticIconId = resolveIngredientSemanticIconId(iconInput);
    if (semanticIconId && isShadcnFoodIconId(semanticIconId)) {
      return <ShadcnFoodIcon iconId={semanticIconId} className={cn("h-4 w-4", className)} />;
    }

    const heuristicKey = resolveIngredientIconKey(iconInput);
    const ingredientIcon = ingredientIconMap[heuristicKey];
    if (ingredientIcon.shadcnIconId) {
      return (
        <ShadcnFoodIcon
          iconId={ingredientIcon.shadcnIconId}
          className={cn("h-4 w-4", ingredientIcon.toneClass, className)}
        />
      );
    }

    const Icon = ingredientIcon.icon ?? UtensilsCrossed;
    return <Icon aria-hidden className={cn("h-4 w-4", ingredientIcon.toneClass, className)} />;
  }

  const entity = entityTypeIconMap[entityType];
  const Icon = entity?.icon ?? Circle;
  return <Icon aria-hidden className={cn("h-4 w-4", entity?.toneClass, className)} />;
}
