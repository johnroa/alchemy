"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
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

type LlmPanelMode = "routing" | "prompts" | "rules";

const ALL_SCOPES = [
  "generate",
  "tweak",
  "classify",
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
}): React.JSX.Element {
  const [routes, setRoutes] = useState(props.routes);
  const [prompts, setPrompts] = useState(props.prompts);
  const [rules, setRules] = useState(props.rules);

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
                <TableHead className="w-44">Provider</TableHead>
                <TableHead>Model Name</TableHead>
                <TableHead className="w-20 text-right">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ALL_SCOPES.map((scope) => (
                <RouteRow
                  key={scope}
                  scope={scope}
                  active={activeByScope[scope]}
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
  const isPrompts = props.mode === "prompts";
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
              onClick={() => { setSelectedScope(scope); setShowCreateForm(false); }}
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
        <Card className="border-emerald-300/60 bg-emerald-50/30">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-300 text-xs">
                  <Check className="h-2.5 w-2.5" /> Active
                </Badge>
                <span className="text-sm font-semibold">{activeItem.name}</span>
                <Badge variant="secondary" className="text-xs">v{activeItem.version}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {isPrompts ? (
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
            return (
              <div key={item.id} className="rounded-md border">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{item.name}</span>
                    <Badge variant="secondary" className="text-xs">v{item.version}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
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
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t px-3 pb-3 pt-2">
                    <pre className="whitespace-pre-wrap rounded-md border bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700">
                      {isPrompts
                        ? (item as Prompt).template
                        : JSON.stringify((item as Rule).rule, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create new version */}
      {showCreateForm ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
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
            <div className="flex justify-end gap-2">
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

function RouteRow({
  scope,
  active,
  onSave
}: {
  scope: string;
  active: LlmRoute | undefined;
  onSave: (provider: string, model: string) => Promise<void>;
}): React.JSX.Element {
  const [provider, setProvider] = useState(active?.provider ?? "openai");
  const [model, setModel] = useState(active?.model ?? "");
  const [saving, setSaving] = useState(false);

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
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. gpt-4.1"
          className="h-8 text-sm"
        />
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={saving}
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
