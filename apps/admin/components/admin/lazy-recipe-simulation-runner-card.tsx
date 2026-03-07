"use client";

import dynamic from "next/dynamic";
import type { RecipeSimulationRunnerCardProps } from "@/components/admin/simulation-runner-card";
import { HeavyPanelLoading } from "@/components/admin/heavy-panel-loading";

const DynamicRecipeSimulationRunnerCard = dynamic(
  () => import("@/components/admin/simulation-runner-card").then((mod) => mod.RecipeSimulationRunnerCard),
  {
    ssr: false,
    loading: () => (
      <HeavyPanelLoading
        title="Loading recipe simulation runner"
        description="Preparing the end-to-end recipe comparison controls."
        heightClassName="h-[720px]"
      />
    ),
  },
);

export function LazyRecipeSimulationRunnerCard(props: RecipeSimulationRunnerCardProps): React.JSX.Element {
  return <DynamicRecipeSimulationRunnerCard {...props} />;
}
