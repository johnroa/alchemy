"use client";

import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GraphControlsProps {
  maxNodes: number;
  onMaxNodesChange: (value: number) => void;
  relationFilter: string;
  onRelationFilterChange: (value: string) => void;
  relationTypes: string[];
  entityTypes: string[];
  activeTypes: string[];
  onToggleType: (type: string) => void;
  onFit: () => void;
  onCenter: () => void;
  onReleasePins: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}

export function GraphControls({
  maxNodes,
  onMaxNodesChange,
  relationFilter,
  onRelationFilterChange,
  relationTypes,
  entityTypes,
  activeTypes,
  onToggleType,
  onFit,
  onCenter,
  onReleasePins,
  onToggleFullscreen,
  isFullscreen,
}: GraphControlsProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-md border bg-white p-3">
      <label className="w-full text-xs font-medium text-muted-foreground sm:w-32">
        Max Nodes
        <Input
          type="number"
          min={10}
          max={500}
          value={maxNodes}
          className="mt-1 h-8"
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) {
              onMaxNodesChange(parsed);
            }
          }}
        />
      </label>

      <label className="w-full text-xs font-medium text-muted-foreground sm:w-44">
        Relation Filter
        <select
          className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={relationFilter}
          onChange={(event) => onRelationFilterChange(event.target.value)}
        >
          <option value="all">All relations</option>
          {relationTypes.map((relationType) => (
            <option key={relationType} value={relationType}>
              {relationType}
            </option>
          ))}
        </select>
      </label>

      <div className="flex min-w-0 flex-wrap gap-1.5">
        {entityTypes.map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={activeTypes.includes(type) ? "default" : "outline"}
            className="h-7 px-2 text-[11px]"
            onClick={() => onToggleType(type)}
          >
            <EntityTypeIcon entityType={type} className="mr-1 h-3.5 w-3.5" />
            {type}
          </Button>
        ))}
      </div>

      <div className="flex w-full flex-wrap gap-1.5 md:justify-end">
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onFit}>
          Fit
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onCenter}>
          Center
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onFit}>
          Reset Zoom
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onReleasePins}>
          Release Pins
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onToggleFullscreen}>
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </Button>
      </div>
    </div>
  );
}
