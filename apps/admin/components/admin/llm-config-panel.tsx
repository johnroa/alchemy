"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type LlmRoute = {
  id: string;
  scope: string;
  route_name: string;
  provider: string;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
};

type Prompt = {
  id: string;
  scope: string;
  version: number;
  name: string;
  template: string;
  is_active: boolean;
};

type Rule = {
  id: string;
  scope: string;
  version: number;
  name: string;
  rule: Record<string, unknown>;
  is_active: boolean;
};

export type RegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  is_available: boolean;
  notes: string | null;
};

type LlmPanelMode = "routing" | "prompts" | "rules" | "models";

const ALL_SCOPES = [
  "chat",
  "chat_ideation",
  "chat_generation",
  "chat_iteration",
  "generate",
  "tweak",
  "classify",
  "ingredient_alias_normalize",
  "ingredient_phrase_split",
  "ingredient_enrich",
  "recipe_metadata_enrich",
  "ingredient_relation_infer",
  "preference_normalize",
  "equipment_filter",
  "onboarding",
  "image",
  "memory_extract",
  "memory_select",
  "memory_summarize",
  "memory_conflict_resolve"
] as const;

type Scope = (typeof ALL_SCOPES)[number];

export function LlmConfigPanel(props: {
  mode: LlmPanelMode;
  routes: LlmRoute[];
  prompts: Prompt[];
  rules: Rule[];
  models: RegistryModel[];
}): React.JSX.Element {
  const [routes, setRoutes] = useState(props.routes);
  const [prompts, setPrompts] = useState(props.prompts);
  const [rules, setRules] = useState(props.rules);
  const [models, setModels] = useState(props.models);

  // Scope selector state
  const [selectedScope, setSelectedScope] = useState<Scope>(ALL_SCOPES[0]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create prompt state
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptTemplate, setNewPromptTemplate] = useState("");
  const [creatingPrompt, setCreatingPrompt] = useState(false);

  // Create rule state
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleBody, setNewRuleBody] = useState(
    '{\n  "allowed_domains": ["recipe", "chef", "ingredient", "technique"],\n  "reject_out_of_scope": true\n}'
  );
  const [creatingRule, setCreatingRule] = useState(false);

  // Inline editor state (edit existing prompt/rule → creates new version on save)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditor = (item: Prompt | Rule): void => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditBody(isPrompts ? (item as Prompt).template : JSON.stringify((item as Rule).rule, null, 2));
    setShowCreateForm(false);
  };

  const cancelEditor = (): void => {
    setEditingId(null);
    setEditName("");
    setEditBody("");
  };

  const saveEdit = async (): Promise<void> => {
    if (!editName.trim() || !editBody.trim()) {
      toast.error(isPrompts ? "Name and template required" : "Name and body required");
      return;
    }
    let parsedRule: Record<string, unknown> | undefined;
    if (!isPrompts) {
      try { parsedRule = JSON.parse(editBody) as Record<string, unknown>; }
      catch { toast.error("Rule body must be valid JSON"); return; }
    }
    setSavingEdit(true);
    const body = isPrompts
      ? { action: "create", scope: selectedScope, name: editName.trim(), template: editBody.trim(), auto_activate: true }
      : { action: "create", scope: selectedScope, name: editName.trim(), rule: parsedRule, auto_activate: true };
    const res = await fetch(`/api/admin/llm/${isPrompts ? "prompts" : "rules"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setSavingEdit(false);
    if (!res.ok) { toast.error("Failed to save"); return; }
    if (isPrompts) {
      const payload = (await res.json()) as { prompts: Prompt[] };
      setPrompts(payload.prompts);
    } else {
      const payload = (await res.json()) as { rules: Rule[] };
      setRules(payload.rules);
    }
    cancelEditor();
    toast.success("New version created and activated");
  };

  // Expanded inactive version IDs
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isPrompts = props.mode === "prompts";

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

  const activatePrompt = async (promptId: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId, action: "activate" })
    });
    if (!res.ok) { toast.error("Failed to activate prompt"); return; }
    const payload = (await res.json()) as { prompts: Prompt[] };
    setPrompts(payload.prompts);
    toast.success("Prompt activated");
  };

  const activateRule = async (ruleId: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule_id: ruleId, action: "activate" })
    });
    if (!res.ok) { toast.error("Failed to activate rule"); return; }
    const payload = (await res.json()) as { rules: Rule[] };
    setRules(payload.rules);
    toast.success("Rule activated");
  };

  const createPrompt = async (): Promise<void> => {
    if (!newPromptName.trim() || !newPromptTemplate.trim()) {
      toast.error("Prompt name and template are required");
      return;
    }
    setCreatingPrompt(true);
    const res = await fetch("/api/admin/llm/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", scope: selectedScope, name: newPromptName.trim(), template: newPromptTemplate.trim() })
    });
    setCreatingPrompt(false);
    if (!res.ok) { toast.error("Failed to create prompt"); return; }
    const payload = (await res.json()) as { prompts: Prompt[] };
    setPrompts(payload.prompts);
    setNewPromptName("");
    setNewPromptTemplate("");
    setShowCreateForm(false);
    toast.success("Prompt version created");
  };

  const createRule = async (): Promise<void> => {
    if (!newRuleName.trim() || !newRuleBody.trim()) {
      toast.error("Rule name and body are required");
      return;
    }
    let parsedRule: Record<string, unknown>;
    try {
      parsedRule = JSON.parse(newRuleBody) as Record<string, unknown>;
    } catch {
      toast.error("Rule body must be valid JSON");
      return;
    }
    setCreatingRule(true);
    const res = await fetch("/api/admin/llm/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", scope: selectedScope, name: newRuleName.trim(), rule: parsedRule })
    });
    setCreatingRule(false);
    if (!res.ok) { toast.error("Failed to create rule"); return; }
    const payload = (await res.json()) as { rules: Rule[] };
    setRules(payload.rules);
    setNewRuleName("");
    setShowCreateForm(false);
    toast.success("Rule version created");
  };

  // ── Models tab ──────────────────────────────────────────────────────────────
  if (props.mode === "models") {
    return (
      <ModelsPanel
        models={models}
        onModelsChange={setModels}
      />
    );
  }

  // ── Routing mode ───────────────────────────────────────────────────────────
  if (props.mode === "routing") {
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

  // ── Prompts / Rules shared scope-picker layout ─────────────────────────────
  const items = isPrompts ? prompts : rules;

  const scopeItems = items.filter((item) => item.scope === selectedScope);
  const activeItem = scopeItems.find((item) => item.is_active);
  const inactiveItems = scopeItems.filter((item) => !item.is_active);

  const scopeHasActive = (scope: Scope): boolean =>
    isPrompts
      ? prompts.some((p) => p.scope === scope && p.is_active)
      : rules.some((r) => r.scope === scope && r.is_active);

  return (
    <div className="space-y-4">
      {/* Scope selector */}
      <div className="flex flex-wrap gap-2">
        {ALL_SCOPES.map((scope) => {
          const hasActive = scopeHasActive(scope);
          const count = items.filter((i) => i.scope === scope).length;
          return (
            <button
              key={scope}
              onClick={() => { setSelectedScope(scope); setShowCreateForm(false); cancelEditor(); }}
              className={cn(
                "relative flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                selectedScope === scope
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {scope}
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] px-1 py-0",
                    selectedScope === scope ? "bg-primary-foreground/20 text-primary-foreground" : ""
                  )}
                >
                  {count}
                </Badge>
              )}
              {hasActive && (
                <span
                  className={cn(
                    "absolute -right-1 -top-1 h-2 w-2 rounded-full border border-white",
                    selectedScope === scope ? "bg-emerald-300" : "bg-emerald-500"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Active item for selected scope */}
      {activeItem ? (
        <Card className={editingId === activeItem.id ? undefined : "border-emerald-300 bg-emerald-50"}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editingId === activeItem.id ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 w-full text-sm font-medium sm:max-w-sm"
                  placeholder="Version name"
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-300 text-xs">
                    <Check className="h-2.5 w-2.5" /> Active
                  </Badge>
                  <span className="text-sm font-semibold">{activeItem.name}</span>
                  <Badge variant="secondary" className="text-xs">v{activeItem.version}</Badge>
                </div>
              )}
              <div className="flex items-center gap-2">
                {editingId === activeItem.id ? (
                  <>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={cancelEditor}>Cancel</Button>
                    <Button size="sm" className="h-7 text-xs" disabled={savingEdit} onClick={() => void saveEdit()}>
                      {savingEdit ? "Saving…" : "Save as New Version"}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => openEditor(activeItem)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {editingId === activeItem.id ? (
              <Textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className={cn("font-mono text-xs", isPrompts ? "min-h-[300px]" : "min-h-[160px]")}
              />
            ) : isPrompts ? (
              <pre className="whitespace-pre-wrap rounded-md border border-emerald-200 bg-white p-3 font-mono text-xs leading-relaxed text-zinc-700">
                {(activeItem as Prompt).template}
              </pre>
            ) : (
              <pre className="whitespace-pre-wrap rounded-md border border-emerald-200 bg-white p-3 font-mono text-xs leading-relaxed text-zinc-700">
                {JSON.stringify((activeItem as Rule).rule, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No active {isPrompts ? "prompt" : "rule"} for <span className="font-mono">{selectedScope}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create a version below and activate it to configure this scope.
          </p>
        </div>
      )}

      {/* Previous versions */}
      {inactiveItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {inactiveItems.length} inactive version{inactiveItems.length !== 1 ? "s" : ""}
          </p>
          {inactiveItems.map((item) => {
            const isExpanded = expandedIds.has(item.id);
            const isEditingThis = editingId === item.id;
            return (
              <div key={item.id} className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  {isEditingThis ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 max-w-xs text-xs font-medium"
                      placeholder="Version name"
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.name}</span>
                      <Badge variant="secondary" className="text-xs">v{item.version}</Badge>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {isEditingThis ? (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={cancelEditor}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" disabled={savingEdit} onClick={() => void saveEdit()}>
                          {savingEdit ? "Saving…" : "Save as New Version"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => openEditor(item)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => isPrompts ? void activatePrompt(item.id) : void activateRule(item.id)}
                        >
                          Activate
                        </Button>
                        <button
                          onClick={() => toggleExpanded(item.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-zinc-100"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isEditingThis ? (
                  <div className="border-t px-3 pb-3 pt-2">
                    <Textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className={cn("font-mono text-xs", isPrompts ? "min-h-[300px]" : "min-h-[160px]")}
                    />
                  </div>
                ) : isExpanded ? (
                  <div className="border-t px-3 pb-3 pt-2">
                    <pre className="whitespace-pre-wrap rounded-md border bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700">
                      {isPrompts
                        ? (item as Prompt).template
                        : JSON.stringify((item as Rule).rule, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Create new version */}
      {showCreateForm ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" />
                New {isPrompts ? "Prompt" : "Rule"} Version for{" "}
                <span className="font-mono">{selectedScope}</span>
              </CardTitle>
              <button
                onClick={() => setShowCreateForm(false)}
                className="rounded p-1 text-muted-foreground hover:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={isPrompts ? newPromptName : newRuleName}
              onChange={(e) => isPrompts ? setNewPromptName(e.target.value) : setNewRuleName(e.target.value)}
              placeholder={isPrompts ? "Prompt name (e.g. v2_chain_of_thought)" : "Rule name (e.g. strict_recipe_scope)"}
            />
            <Textarea
              value={isPrompts ? newPromptTemplate : newRuleBody}
              onChange={(e) => isPrompts ? setNewPromptTemplate(e.target.value) : setNewRuleBody(e.target.value)}
              className={cn("font-mono text-xs", isPrompts ? "min-h-[200px]" : "min-h-[140px]")}
              placeholder={isPrompts ? "Write the full system prompt template…" : '{"allowed_domains": ["recipe"]}'}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button
                onClick={() => isPrompts ? void createPrompt() : void createRule()}
                disabled={isPrompts ? creatingPrompt : creatingRule}
              >
                {(isPrompts ? creatingPrompt : creatingRule) ? "Creating…" : `Create Version`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => setShowCreateForm(true)}
        >
          <Plus className="h-4 w-4" />
          New {isPrompts ? "Prompt" : "Rule"} Version for <span className="font-mono">{selectedScope}</span>
        </Button>
      )}
    </div>
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
  const providers = useMemo(
    () => Array.from(new Set(registryModels.filter((m) => m.is_available).map((m) => m.provider))).sort(),
    [registryModels]
  );

  const [provider, setProvider] = useState(active?.provider ?? providers[0] ?? "");
  const [model, setModel] = useState(active?.model ?? "");
  const [saving, setSaving] = useState(false);

  const modelsForProvider = useMemo(
    () => registryModels.filter((m) => m.provider === provider && m.is_available),
    [registryModels, provider]
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

// ── Models registry management panel ──────────────────────────────────────

function ModelsPanel({
  models,
  onModelsChange
}: {
  models: RegistryModel[];
  onModelsChange: (models: RegistryModel[]) => void;
}): React.JSX.Element {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [newProvider, setNewProvider] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newInputCost, setNewInputCost] = useState("0");
  const [newOutputCost, setNewOutputCost] = useState("0");
  const [newContextWindow, setNewContextWindow] = useState("");
  const [newMaxOutput, setNewMaxOutput] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async (): Promise<void> => {
    if (!newProvider.trim() || !newModel.trim() || !newDisplayName.trim()) {
      toast.error("Provider, model ID, and display name are required");
      return;
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
        context_window_tokens: newContextWindow ? Number(newContextWindow) : null,
        max_output_tokens: newMaxOutput ? Number(newMaxOutput) : null,
        notes: newNotes.trim() || null,
        is_available: true
      })
    });
    setAdding(false);
    if (!res.ok) { toast.error("Failed to add model"); return; }
    const payload = (await res.json()) as { models: RegistryModel[] };
    onModelsChange(payload.models);
    setShowAddForm(false);
    setNewProvider(""); setNewModel(""); setNewDisplayName("");
    setNewInputCost("0"); setNewOutputCost("0");
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

  const handleSaveCosts = async (m: RegistryModel, inputCost: string, outputCost: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/models", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: m.id,
        input_cost_per_1m_tokens: Number(inputCost),
        output_cost_per_1m_tokens: Number(outputCost)
      })
    });
    if (!res.ok) { toast.error("Failed to update costs"); return; }
    const payload = (await res.json()) as { models: RegistryModel[] };
    onModelsChange(payload.models);
    setEditingId(null);
    toast.success("Costs updated");
  };

  const providers = Array.from(new Set(models.map((m) => m.provider))).sort();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base">Model Registry</CardTitle>
            <CardDescription>All available providers and models with per-token pricing. Used for routing dropdowns and cost tracking.</CardDescription>
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
                          onSaveCosts={handleSaveCosts}
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

function ModelRow({
  model,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveCosts,
  onToggleAvailable,
  onDelete
}: {
  model: RegistryModel;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveCosts: (m: RegistryModel, inputCost: string, outputCost: string) => Promise<void>;
  onToggleAvailable: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [inputCost, setInputCost] = useState(String(model.input_cost_per_1m_tokens));
  const [outputCost, setOutputCost] = useState(String(model.output_cost_per_1m_tokens));
  const [saving, setSaving] = useState(false);

  if (isEditing) {
    return (
      <TableRow>
        <TableCell className="font-medium text-sm">{model.display_name}</TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">{model.model}</TableCell>
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
              await onSaveCosts(model, inputCost, outputCost);
              setSaving(false);
            }}>
              {saving ? "…" : "Save"}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className={cn(!model.is_available && "opacity-50")}>
      <TableCell className="font-medium text-sm">{model.display_name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{model.model}</TableCell>
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
