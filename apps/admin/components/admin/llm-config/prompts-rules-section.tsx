"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ALL_SCOPES, type Prompt, type Rule, type Scope } from "./types";

/**
 * Shared section for both prompt and rule management. The `kind` prop
 * determines which entity type is displayed. Both share the same
 * scope-picker, active/inactive version list, inline editor, and
 * create-form patterns.
 */
export function PromptsRulesSection({
  kind,
  prompts,
  rules,
  onPromptsChange,
  onRulesChange
}: {
  kind: "prompts" | "rules";
  prompts: Prompt[];
  rules: Rule[];
  onPromptsChange: (prompts: Prompt[]) => void;
  onRulesChange: (rules: Rule[]) => void;
}): React.JSX.Element {
  const isPrompts = kind === "prompts";
  const items = isPrompts ? prompts : rules;

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
      onPromptsChange(payload.prompts);
    } else {
      const payload = (await res.json()) as { rules: Rule[] };
      onRulesChange(payload.rules);
    }
    cancelEditor();
    toast.success("New version created and activated");
  };

  const activatePrompt = async (promptId: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId, action: "activate" })
    });
    if (!res.ok) { toast.error("Failed to activate prompt"); return; }
    const payload = (await res.json()) as { prompts: Prompt[] };
    onPromptsChange(payload.prompts);
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
    onRulesChange(payload.rules);
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
    onPromptsChange(payload.prompts);
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
    onRulesChange(payload.rules);
    setNewRuleName("");
    setShowCreateForm(false);
    toast.success("Rule version created");
  };

  // ── Derived data for selected scope ─────────────────────────────────────

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
                    "absolute -right-1 -top-1 h-2 w-2 rounded-full border border-background",
                    selectedScope === scope ? "bg-emerald-300 dark:bg-emerald-400" : "bg-emerald-500 dark:bg-emerald-400"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Active item for selected scope */}
      {activeItem ? (
        <Card className={editingId === activeItem.id ? undefined : "border-emerald-500/30 bg-emerald-500/10"}>
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
                  <Badge className="gap-1 border-emerald-500/35 bg-emerald-500/15 text-xs text-emerald-700 dark:text-emerald-300">
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
              <pre className="whitespace-pre-wrap rounded-md border border-emerald-500/25 bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground shadow-sm">
                {(activeItem as Prompt).template}
              </pre>
            ) : (
              <pre className="whitespace-pre-wrap rounded-md border border-emerald-500/25 bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground shadow-sm">
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
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name}`}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
                    <pre className="whitespace-pre-wrap rounded-md border border-border/80 bg-muted/35 p-3 font-mono text-xs leading-relaxed text-foreground/90">
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
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
