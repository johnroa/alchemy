import type { components } from "@alchemy/contracts";
import { notFound } from "next/navigation";
import { buildIngredientBadges } from "@/lib/ingredient-badges";
import { buildPageMetadata } from "@/lib/metadata";
import { getPublicRecipe } from "@/lib/api";
import { buildRecipeDescriptors, buildRecipeStats } from "@/lib/recipe-view";

type RecipePageProps = {
  params: Promise<{ id: string }>;
};

type RecipeIngredient = components["schemas"]["Ingredient"];
type RecipeStep = components["schemas"]["Step"];

export async function generateMetadata({ params }: RecipePageProps) {
  const { id } = await params;
  const recipe = await getPublicRecipe(id);

  if (!recipe) {
    return buildPageMetadata({
      title: "Recipe Not Found",
      description: "This recipe is unavailable.",
      pathname: `/recipes/${id}`
    });
  }

  return buildPageMetadata({
    title: recipe.title,
    description: recipe.summary ?? recipe.description ?? "Public recipe page",
    pathname: `/recipes/${id}`,
    ...(recipe.image_url ? { image: recipe.image_url } : {})
  });
}

export default async function RecipePage({ params }: RecipePageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const recipe = await getPublicRecipe(id);

  if (!recipe || recipe.visibility !== "public") {
    notFound();
  }

  const stats = buildRecipeStats(recipe);
  const descriptors = buildRecipeDescriptors(recipe.metadata);
  const ingredientBadges = buildIngredientBadges(recipe.ingredients);

  return (
    <div className="container py-12 sm:py-16">
      <article className="overflow-hidden rounded-[2.4rem] border border-border/70 bg-white/76 shadow-card backdrop-blur">
        <div className="grid gap-8 border-b border-border/70 p-8 lg:grid-cols-[1.05fr_0.95fr] lg:p-10">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-olive-300/80 bg-saffron-200/24 px-4 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">
              Public recipe share
            </div>
            <div className="space-y-4">
              <h1 className="font-display text-4xl leading-tight text-olive-700 sm:text-5xl">
                {recipe.title}
              </h1>
              <p className="max-w-2xl text-base leading-8 text-olive-700/74 sm:text-lg">
                {recipe.summary ?? recipe.description ?? "A canonical Alchemy recipe."}
              </p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-[1.4rem] border border-border/70 bg-surface/80 p-4">
                  <dt className="text-xs uppercase tracking-[0.24em] text-olive-500">{stat.label}</dt>
                  <dd className="mt-2 text-lg font-semibold text-olive-700">{stat.value}</dd>
                </div>
              ))}
            </dl>
            {descriptors.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {descriptors.map((descriptor) => (
                  <span
                    key={descriptor}
                    className="rounded-full border border-olive-300/70 bg-white/78 px-3 py-1 text-sm text-olive-700"
                  >
                    {descriptor}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-olive-100/60">
            {recipe.image_url ? (
              <img
                src={recipe.image_url}
                alt={recipe.title}
                className="h-full min-h-[320px] w-full object-cover"
              />
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center bg-hero-grid bg-hero-grid p-10 text-center">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">No hero image yet</p>
                  <p className="font-display text-3xl text-olive-700">{recipe.title}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-10 p-8 lg:grid-cols-[0.9fr_1.1fr] lg:p-10">
          <aside className="space-y-8">
            <section className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">Ingredient map</p>
                <h2 className="mt-2 font-display text-3xl text-olive-700">What this recipe leans on</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                {ingredientBadges.map((badge) => (
                  <div
                    key={badge.key}
                    className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface/80 px-4 py-2 text-sm text-olive-700"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-olive-700 text-[10px] font-semibold tracking-[0.18em] text-white"
                    >
                      {badge.token}
                    </span>
                    <span>{badge.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">Ingredients</p>
                <h2 className="mt-2 font-display text-3xl text-olive-700">Prep list</h2>
              </div>
              <ul className="space-y-3">
                {recipe.ingredients.map((ingredient: RecipeIngredient, index) => (
                  <li
                    key={`${ingredient.name}-${index}`}
                    className="rounded-[1.4rem] border border-border/70 bg-surface/78 px-4 py-3 text-sm text-olive-700"
                  >
                    <span className="font-semibold">
                      {ingredient.amount} {ingredient.unit}
                    </span>{" "}
                    {ingredient.name}
                    {ingredient.preparation ? `, ${ingredient.preparation}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          </aside>

          <section className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">Method</p>
              <h2 className="mt-2 font-display text-3xl text-olive-700">Cook through it</h2>
            </div>
            <ol className="space-y-4">
              {recipe.steps.map((step: RecipeStep) => (
                <li
                  key={step.index}
                  className="rounded-[1.6rem] border border-border/70 bg-white/80 p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-olive-700 text-sm font-semibold text-white">
                      {step.index}
                    </div>
                    <div className="space-y-2">
                      <p className="text-base leading-7 text-olive-700">{step.instruction}</p>
                      {step.notes ? (
                        <p className="text-sm leading-6 text-olive-700/68">{step.notes}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {recipe.notes ? (
              <div className="rounded-[1.6rem] border border-border/70 bg-saffron-200/22 p-5 text-sm leading-7 text-olive-700">
                {recipe.notes}
              </div>
            ) : null}
          </section>
        </div>
      </article>
    </div>
  );
}
