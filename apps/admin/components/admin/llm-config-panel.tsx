"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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

export function LlmConfigPanel(props: {
  mode: LlmPanelMode;
  routes: LlmRoute[];
  prompts: Prompt[];
  rules: Rule[];
}): React.JSX.Element {
  const [routes, setRoutes] = useState(props.routes);
  const [prompts, setPrompts] = useState(props.prompts);
  const [rules, setRules] = useState(props.rules);
  const [newPromptScope, setNewPromptScope] = useState("generate");
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptTemplate, setNewPromptTemplate] = useState("");
  const [newRuleScope, setNewRuleScope] = useState("generate");
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleBody, setNewRuleBody] = useState("{\n  \"allowed_domains\": [\"recipe\", \"chef\", \"ingredient\", \"technique\"],\n  \"reject_out_of_scope\": true\n}");

  const activeByScope = useMemo(() => {
    return {
      generate: routes.find((route) => route.scope === "generate" && route.is_active),
      tweak: routes.find((route) => route.scope === "tweak" && route.is_active),
      classify: routes.find((route) => route.scope === "classify" && route.is_active),
      image: routes.find((route) => route.scope === "image" && route.is_active)
    };
  }, [routes]);

  const updateRoute = async (scope: string, provider: string, model: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, provider, model })
    });

    if (!res.ok) {
      toast.error("Failed to update model route");
      return;
    }

    const payload = (await res.json()) as { routes: LlmRoute[] };
    setRoutes(payload.routes);
    toast.success("Model route updated");
  };

  const activatePrompt = async (promptId: string): Promise<void> => {
    const res = await fetch("/api/admin/llm/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId, action: "activate" })
    });

    if (!res.ok) {
      toast.error("Failed to activate prompt");
      return;
    }

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

    if (!res.ok) {
      toast.error("Failed to activate rule");
      return;
    }

    const payload = (await res.json()) as { rules: Rule[] };
    setRules(payload.rules);
    toast.success("Rule activated");
  };

  const createPrompt = async (): Promise<void> => {
    if (!newPromptName.trim() || !newPromptTemplate.trim()) {
      toast.error("Prompt name and template are required");
      return;
    }

    const res = await fetch("/api/admin/llm/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create",
        scope: newPromptScope,
        name: newPromptName.trim(),
        template: newPromptTemplate.trim()
      })
    });

    if (!res.ok) {
      toast.error("Failed to create prompt");
      return;
    }

    const payload = (await res.json()) as { prompts: Prompt[] };
    setPrompts(payload.prompts);
    setNewPromptName("");
    setNewPromptTemplate("");
    toast.success("Prompt created");
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

    const res = await fetch("/api/admin/llm/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create",
        scope: newRuleScope,
        name: newRuleName.trim(),
        rule: parsedRule
      })
    });

    if (!res.ok) {
      toast.error("Failed to create rule");
      return;
    }

    const payload = (await res.json()) as { rules: Rule[] };
    setRules(payload.rules);
    setNewRuleName("");
    toast.success("Rule created");
  };

  if (props.mode === "routing") {
    return (
      <div className="space-y-4">
        {(["generate", "tweak", "classify", "image"] as const).map((scope) => {
          const active = activeByScope[scope];
          return (
            <Card key={scope}>
              <CardHeader>
                <CardTitle className="capitalize">{scope} route</CardTitle>
                <CardDescription>Provider and model are fully admin-managed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Active</Badge>
                  <span className="text-sm text-muted-foreground">
                    {active ? `${active.provider} / ${active.model}` : "Not configured"}
                  </span>
                </div>
                <RouteEditor
                  initialProvider={active?.provider ?? "openai"}
                  initialModel={active?.model ?? "gpt-4.1"}
                  onSave={(provider, model) => updateRoute(scope, provider, model)}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  if (props.mode === "prompts") {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Create Prompt Version</CardTitle>
            <CardDescription>All generation instructions are authored and versioned here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[180px,1fr]">
              <Select value={newPromptScope} onValueChange={setNewPromptScope}>
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generate">generate</SelectItem>
                  <SelectItem value="tweak">tweak</SelectItem>
                  <SelectItem value="classify">classify</SelectItem>
                  <SelectItem value="image">image</SelectItem>
                </SelectContent>
              </Select>
              <Input value={newPromptName} onChange={(event) => setNewPromptName(event.target.value)} placeholder="Prompt name" />
            </div>
            <Textarea
              value={newPromptTemplate}
              onChange={(event) => setNewPromptTemplate(event.target.value)}
              className="min-h-[140px]"
              placeholder="Write full instruction template here..."
            />
            <div className="flex justify-end">
              <Button onClick={() => void createPrompt()}>Create Prompt</Button>
            </div>
          </CardContent>
        </Card>

        {prompts.map((prompt) => (
          <Card key={prompt.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>{prompt.name}</span>
                <Badge variant={prompt.is_active ? "default" : "outline"}>{prompt.scope}</Badge>
                <Badge variant={prompt.is_active ? "secondary" : "outline"}>v{prompt.version}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea readOnly value={prompt.template} className="min-h-[140px]" />
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => activatePrompt(prompt.id)}>
                  Set Active
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Rule Version</CardTitle>
          <CardDescription>Rules are data-driven and activated per scope.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[180px,1fr]">
            <Select value={newRuleScope} onValueChange={setNewRuleScope}>
              <SelectTrigger>
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generate">generate</SelectItem>
                <SelectItem value="tweak">tweak</SelectItem>
                <SelectItem value="classify">classify</SelectItem>
                <SelectItem value="image">image</SelectItem>
              </SelectContent>
            </Select>
            <Input value={newRuleName} onChange={(event) => setNewRuleName(event.target.value)} placeholder="Rule name" />
          </div>
          <Textarea
            value={newRuleBody}
            onChange={(event) => setNewRuleBody(event.target.value)}
            className="min-h-[140px] font-mono text-xs"
            placeholder='{"allowed_domains": ["recipe"]}'
          />
          <div className="flex justify-end">
            <Button onClick={() => void createRule()}>Create Rule</Button>
          </div>
        </CardContent>
      </Card>

      {rules.map((rule) => (
        <Card key={rule.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>{rule.name}</span>
              <Badge variant={rule.is_active ? "default" : "outline"}>{rule.scope}</Badge>
              <Badge variant={rule.is_active ? "secondary" : "outline"}>v{rule.version}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea readOnly value={JSON.stringify(rule.rule, null, 2)} className="min-h-[140px] font-mono text-xs" />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => activateRule(rule.id)}>
                Set Active
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RouteEditor(props: {
  initialProvider: string;
  initialModel: string;
  onSave: (provider: string, model: string) => Promise<void>;
}): React.JSX.Element {
  const [provider, setProvider] = useState(props.initialProvider);
  const [model, setModel] = useState(props.initialModel);

  return (
    <div className="grid gap-3 md:grid-cols-[220px,1fr,auto]">
      <Select value={provider} onValueChange={setProvider}>
        <SelectTrigger>
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">OpenAI</SelectItem>
        </SelectContent>
      </Select>
      <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model name" />
      <Button onClick={() => void props.onSave(provider, model)}>Save</Button>
    </div>
  );
}
