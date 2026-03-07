"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { RegistryModel } from "./types";

// ── Models registry management panel ──────────────────────────────────────

export function ModelsSection({
  models,
  onModelsChange
}: {
  models: RegistryModel[];
  onModelsChange: (models: RegistryModel[]) => void;
}): React.JSX.Element {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [newProvider, setNewProvider] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newInputCost, setNewInputCost] = useState("0");
  const [newOutputCost, setNewOutputCost] = useState("0");
  const [newBillingMode, setNewBillingMode] = useState<"token" | "image">("token");
  const [newBillingMetadata, setNewBillingMetadata] = useState("{}");
  const [newContextWindow, setNewContextWindow] = useState("");
  const [newMaxOutput, setNewMaxOutput] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async (): Promise<void> => {
    if (!newProvider.trim() || !newModel.trim() || !newDisplayName.trim()) {
      toast.error("Provider, model ID, and display name are required");
      return;
    }
    let parsedBillingMetadata: Record<string, unknown> = {};
    if (newBillingMode === "image") {
      try {
        const parsed = JSON.parse(newBillingMetadata) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          toast.error("Billing metadata must be a JSON object");
          return;
        }
        parsedBillingMetadata = parsed as Record<string, unknown>;
      } catch {
        toast.error("Billing metadata must be valid JSON");
        return;
      }
    }
    setAdding(true);
    const res = await fetch("/api/admin/llm/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: newProvider.trim(),
        model: newModel.trim(),
        display_name: newDisplayName.trim(),
        input_cost_per_1m_tokens: Number(newInputCost),
        output_cost_per_1m_tokens: Number(newOutputCost),
        billing_mode: newBillingMode,
        billing_metadata: parsedBillingMetadata,
        context_window_tokens: newContextWindow ? Number(newContextWindow) : null,
        max_output_tokens: newMaxOutput ? Number(newMaxOutput) : null,
        notes: newNotes.trim() || null,
        is_available: true
      })
    });
    setAdding(false);
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? "Failed to add model");
      return;
    }
    const payload = (await res.json()) as { models: RegistryModel[] };
    onModelsChange(payload.models);
    setShowAddForm(false);
    setNewProvider(""); setNewModel(""); setNewDisplayName("");
    setNewInputCost("0"); setNewOutputCost("0");
    setNewBillingMode("token"); setNewBillingMetadata("{}");
    setNewContextWindow(""); setNewMaxOutput(""); setNewNotes("");
    toast.success(`${newDisplayName} added to registry`);
  };

  const handleDelete = async (id: string, displayName: string): Promise<void> => {
    if (!confirm(`Remove "${displayName}" from the registry?`)) return;
    const res = await fetch(`/api/admin/llm/models?id=${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to remove model"); return; }
    const payload = (await res.json()) as { models: RegistryModel[] };
    onModelsChange(payload.models);
    toast.success(`${displayName} removed`);
  };

  const handleToggleAvailable = async (m: RegistryModel): Promise<void> => {
    const res = await fetch("/api/admin/llm/models", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: m.id, is_available: !m.is_available })
    });
    if (!res.ok) { toast.error("Failed to update model"); return; }
    const payload = (await res.json()) as { models: RegistryModel[] };
    onModelsChange(payload.models);
  };

  const handleSaveModel = async (
    m: RegistryModel,
    displayName: string,
    modelId: string,
    inputCost: string,
    outputCost: string,
    billingMode: "token" | "image",
    billingMetadata: string
  ): Promise<void> => {
    if (!displayName.trim() || !modelId.trim()) {
      toast.error("Display name and model ID are required");
      return;
    }
    let parsedBillingMetadata: Record<string, unknown> = {};
    if (billingMode === "image") {
      try {
        const parsed = JSON.parse(billingMetadata) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          toast.error("Billing metadata must be a JSON object");
          return;
        }
        parsedBillingMetadata = parsed as Record<string, unknown>;
      } catch {
        toast.error("Billing metadata must be valid JSON");
        return;
      }
    }
    const res = await fetch("/api/admin/llm/models", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: m.id,
        display_name: displayName.trim(),
        model: modelId.trim(),
        input_cost_per_1m_tokens: Number(inputCost),
        output_cost_per_1m_tokens: Number(outputCost),
        billing_mode: billingMode,
        billing_metadata: parsedBillingMetadata
      })
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error ?? "Failed to update model");
      return;
    }
    const payload = (await res.json()) as { models: RegistryModel[] };
    onModelsChange(payload.models);
    setEditingId(null);
    toast.success("Model updated");
  };

  const providers = Array.from(new Set(models.map((m) => m.provider))).sort();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Model Registry</CardTitle>
            <CardDescription>All available providers and models with token or image billing metadata. Used for routing dropdowns and cost tracking.</CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setShowAddForm(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Model
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {models.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No models in registry. Add one to enable provider/model routing.
            </div>
          ) : (
            <div className="space-y-6">
              {providers.map((provider) => (
                <div key={provider}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{provider}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Display Name</TableHead>
                        <TableHead className="font-mono text-xs">Model ID</TableHead>
                        <TableHead className="w-28 text-center">Billing</TableHead>
                        <TableHead className="w-32 text-right">Input $/1M</TableHead>
                        <TableHead className="w-32 text-right">Output $/1M</TableHead>
                        <TableHead className="w-28 text-center">Available</TableHead>
                        <TableHead className="w-20 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {models.filter((m) => m.provider === provider).map((m) => (
                        <ModelRow
                          key={m.id}
                          model={m}
                          isEditing={editingId === m.id}
                          onEdit={() => setEditingId(m.id)}
                          onCancelEdit={() => setEditingId(null)}
                          onSaveModel={handleSaveModel}
                          onToggleAvailable={() => void handleToggleAvailable(m)}
                          onDelete={() => void handleDelete(m.id, m.display_name)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showAddForm && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">Add Model to Registry</CardTitle>
              <button onClick={() => setShowAddForm(false)} className="rounded p-1 text-muted-foreground hover:bg-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <Input value={newProvider} onChange={(e) => setNewProvider(e.target.value)} placeholder="openai" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Model ID</label>
                <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="gpt-5-mini" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Display Name</label>
                <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="GPT-5 Mini" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Billing mode</label>
                <Select value={newBillingMode} onValueChange={(value) => setNewBillingMode(value === "image" ? "image" : "token")}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="token">Token</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Image simulations only include models marked with <span className="font-mono">image</span> billing.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Input $/1M tokens</label>
                <Input value={newInputCost} onChange={(e) => setNewInputCost(e.target.value)} type="number" step="0.01" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Output $/1M tokens</label>
                <Input value={newOutputCost} onChange={(e) => setNewOutputCost(e.target.value)} type="number" step="0.01" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Context window</label>
                <Input value={newContextWindow} onChange={(e) => setNewContextWindow(e.target.value)} type="number" placeholder="128000" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Max output tokens</label>
                <Input value={newMaxOutput} onChange={(e) => setNewMaxOutput(e.target.value)} type="number" placeholder="16384" className="h-8 text-sm" />
              </div>
            </div>
            {newBillingMode === "image" ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Billing metadata (JSON)</label>
                <Textarea
                  value={newBillingMetadata}
                  onChange={(e) => setNewBillingMetadata(e.target.value)}
                  className="min-h-[120px] font-mono text-xs"
                />
              </div>
            ) : null}
            <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Notes (optional)" className="h-8 text-sm" />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
              <Button size="sm" disabled={adding} onClick={() => void handleAdd()}>
                {adding ? "Adding…" : "Add Model"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Individual model row with inline editing ──────────────────────────────

function ModelRow({
  model,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveModel,
  onToggleAvailable,
  onDelete
}: {
  model: RegistryModel;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveModel: (
    m: RegistryModel,
    displayName: string,
    modelId: string,
    inputCost: string,
    outputCost: string,
    billingMode: "token" | "image",
    billingMetadata: string
  ) => Promise<void>;
  onToggleAvailable: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [displayName, setDisplayName] = useState(model.display_name);
  const [modelId, setModelId] = useState(model.model);
  const [inputCost, setInputCost] = useState(String(model.input_cost_per_1m_tokens));
  const [outputCost, setOutputCost] = useState(String(model.output_cost_per_1m_tokens));
  const [billingMode, setBillingMode] = useState<"token" | "image">(model.billing_mode);
  const [billingMetadata, setBillingMetadata] = useState(
    JSON.stringify(model.billing_metadata, null, 2)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    setDisplayName(model.display_name);
    setModelId(model.model);
    setInputCost(String(model.input_cost_per_1m_tokens));
    setOutputCost(String(model.output_cost_per_1m_tokens));
    setBillingMode(model.billing_mode);
    setBillingMetadata(JSON.stringify(model.billing_metadata, null, 2));
  }, [
    isEditing,
    model.display_name,
    model.model,
    model.input_cost_per_1m_tokens,
    model.output_cost_per_1m_tokens,
    model.billing_mode,
    model.billing_metadata
  ]);

  if (isEditing) {
    return (
      <>
        <TableRow>
          <TableCell className="font-medium text-sm">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-7 text-xs"
            />
          </TableCell>
          <TableCell className="font-mono text-xs text-muted-foreground">
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="h-7 font-mono text-xs"
            />
          </TableCell>
          <TableCell className="text-center">
            <Select value={billingMode} onValueChange={(value) => setBillingMode(value === "image" ? "image" : "token")}>
              <SelectTrigger className="ml-auto h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Token</SelectItem>
                <SelectItem value="image">Image</SelectItem>
              </SelectContent>
            </Select>
          </TableCell>
          <TableCell className="text-right">
            <Input
              value={inputCost}
              onChange={(e) => setInputCost(e.target.value)}
              type="number"
              step="0.01"
              className="h-7 w-28 text-right text-xs ml-auto"
            />
          </TableCell>
          <TableCell className="text-right">
            <Input
              value={outputCost}
              onChange={(e) => setOutputCost(e.target.value)}
              type="number"
              step="0.01"
              className="h-7 w-28 text-right text-xs ml-auto"
            />
          </TableCell>
          <TableCell className="text-center">
            <Badge variant={model.is_available ? "default" : "secondary"} className="text-xs">
              {model.is_available ? "Yes" : "No"}
            </Badge>
          </TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-1">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancelEdit}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={async () => {
                setSaving(true);
                await onSaveModel(model, displayName, modelId, inputCost, outputCost, billingMode, billingMetadata);
                setSaving(false);
              }}>
                {saving ? "…" : "Save"}
              </Button>
            </div>
          </TableCell>
        </TableRow>
        {billingMode === "image" ? (
          <TableRow>
            <TableCell colSpan={7} className="bg-zinc-50/60">
              <div className="space-y-1 py-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Billing metadata (JSON)
                </label>
                <Textarea
                  value={billingMetadata}
                  onChange={(e) => setBillingMetadata(e.target.value)}
                  className="min-h-[96px] font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Required for image cost estimates and image simulation dropdowns.
                </p>
              </div>
            </TableCell>
          </TableRow>
        ) : null}
      </>
    );
  }

  return (
    <TableRow className={cn(!model.is_available && "opacity-50")}>
      <TableCell className="font-medium text-sm">{model.display_name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{model.model}</TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className="text-xs">
          {model.billing_mode}
        </Badge>
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">${model.input_cost_per_1m_tokens.toFixed(2)}</TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">${model.output_cost_per_1m_tokens.toFixed(2)}</TableCell>
      <TableCell className="text-center">
        <button onClick={onToggleAvailable} className="cursor-pointer">
          <Badge variant={model.is_available ? "default" : "secondary"} className="text-xs hover:opacity-70 transition-opacity">
            {model.is_available ? "Yes" : "No"}
          </Badge>
        </button>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>Edit</Button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}
