"use client";

import dynamic from "next/dynamic";
import type { ImageSimulationRunnerCardProps } from "@/components/admin/image-simulation-runner-card";
import { HeavyPanelLoading } from "@/components/admin/heavy-panel-loading";

const DynamicImageSimulationRunnerCard = dynamic(
  () => import("@/components/admin/image-simulation-runner-card").then((mod) => mod.ImageSimulationRunnerCard),
  {
    ssr: false,
    loading: () => (
      <HeavyPanelLoading
        title="Loading image simulation runner"
        description="Preparing side-by-side image generation controls."
        heightClassName="h-[680px]"
      />
    ),
  },
);

export function LazyImageSimulationRunnerCard(props: ImageSimulationRunnerCardProps): React.JSX.Element {
  return <DynamicImageSimulationRunnerCard {...props} />;
}
