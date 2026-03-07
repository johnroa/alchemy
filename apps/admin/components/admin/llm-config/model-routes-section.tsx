"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_SCOPES, type LlmRoute, type RegistryModel, type Scope } from "./types";

/**
 * Displays the model routes table — one row per scope showing the active
 * provider/model and dropdowns to reassign. Changes persist immediately
 * via POST /api/admin/llm/routes.
 */
export function ModelRoutesSection({
  routes: initialRoutes,
  models
}: {
  routes: LlmRoute[];
  models: RegistryModel[];
}): React.JSX.Element {
  const [routes, setRoutes] = useState(initialRoutes);

  const activeByScope = useMemo(() => {
    const map: Partial<Record<Scope, LlmRoute | undefined>> = {};
    for (const scope of ALL_SCOPES) {
      map[scope] = routes.find((r) => r.scope === scope && r.is_active);
    }
    return map as Record<Scope, LlmRoute | undefined>;
  }, [routes]);

  const updateRoute = async (scope: string, provider: string, model: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, provider, model })
    });
    if (!res.ok) { toast.error("Failed to update model route"); return; }
    const payload = (await res.json()) as { routes: LlmRoute[] };
    setRoutes(payload.routes);
    toast.success(`Route updated — ${scope}`);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Model Routes</CardTitle>
        <CardDescription>Active provider and model per operational scope. Changes take effect immediately.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Scope</TableHead>
              <TableHead>Active Model</TableHead>
              <TableHead className="w-52">Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="w-20 text-right">Save</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ALL_SCOPES.map((scope) => (
              <RouteRow
                key={scope}
                scope={scope}
                active={activeByScope[scope]}
                registryModels={models}
                onSave={(provider, model) => updateRoute(scope, provider, model)}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── RouteRow: DB-driven provider + model dropdowns ─────────────────────────

function RouteRow({
  scope,
  active,
  registryModels,
  onSave
}: {
  scope: string;
  active: LlmRoute | undefined;
  registryModels: RegistryModel[];
  onSave: (provider: string, model: string) => Promise<void>;
}): React.JSX.Element {
  const scopeFilteredModels = useMemo(
    () => registryModels.filter((model) => {
      if (!model.is_available) {
        return false;
      }
      if (scope === "image") {
        return model.billing_mode === "image";
      }
      return model.billing_mode !== "image";
    }),
    [registryModels, scope]
  );

  const providers = useMemo(
    () => Array.from(new Set(scopeFilteredModels.map((m) => m.provider))).sort(),
    [scopeFilteredModels]
  );

  const [provider, setProvider] = useState(active?.provider ?? providers[0] ?? "");
  const [model, setModel] = useState(active?.model ?? "");
  const [saving, setSaving] = useState(false);

  const modelsForProvider = useMemo(
    () => scopeFilteredModels.filter((m) => m.provider === provider),
    [scopeFilteredModels, provider]
  );

  const handleProviderChange = (p: string): void => {
    setProvider(p);
    setModel("");
  };

  return (
    <TableRow>
      <TableCell>
        <Badge variant="outline" className="font-mono text-xs">
          {scope}
        </Badge>
      </TableCell>
      <TableCell>
        {active ? (
          <span className="text-sm text-muted-foreground">
            {active.provider} / <span className="font-medium text-foreground">{active.model}</span>
          </span>
        ) : (
          <span className="text-xs italic text-muted-foreground/60">Not configured</span>
        )}
      </TableCell>
      <TableCell>
        {providers.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">No providers in registry</span>
        ) : (
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell>
        {modelsForProvider.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">
            {provider ? "No models for this provider" : "Select a provider first"}
          </span>
        ) : (
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {modelsForProvider.map((m) => (
                <SelectItem key={m.model} value={m.model}>
                  {m.display_name}
                  <span className="ml-1 text-xs text-muted-foreground font-mono">({m.model})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={saving || !provider || !model}
          onClick={async () => {
            setSaving(true);
            await onSave(provider, model);
            setSaving(false);
          }}
        >
          {saving ? "…" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
