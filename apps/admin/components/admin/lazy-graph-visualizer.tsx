"use client";

import dynamic from "next/dynamic";
import type { GraphData } from "@/components/admin/graph-visualizer";
import { HeavyPanelLoading } from "@/components/admin/heavy-panel-loading";

const DynamicGraphVisualizer = dynamic(
  () => import("@/components/admin/graph-visualizer").then((mod) => mod.GraphVisualizer),
  {
    ssr: false,
    loading: () => (
      <HeavyPanelLoading
        title="Loading graph canvas"
        description="Preparing the interactive relationship explorer."
        heightClassName="h-[640px]"
      />
    ),
  },
);

export function LazyGraphVisualizer({ graph }: { graph: GraphData }): React.JSX.Element {
  return <DynamicGraphVisualizer graph={graph} />;
}
