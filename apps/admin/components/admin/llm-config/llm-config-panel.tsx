"use client";

import { useState } from "react";
import type { LlmPanelMode, LlmRoute, Prompt, RegistryModel, Rule } from "./types";
import { ModelRoutesSection } from "./model-routes-section";
import { ModelsSection } from "./models-section";
import { PromptsRulesSection } from "./prompts-rules-section";

/**
 * Top-level orchestrator for the LLM configuration panel. Holds canonical
 * state for routes/prompts/rules/models and delegates rendering to the
 * focused section component matching the current mode.
 */
export function LlmConfigPanel(props: {
  mode: LlmPanelMode;
  routes: LlmRoute[];
  prompts: Prompt[];
  rules: Rule[];
  models: RegistryModel[];
}): React.JSX.Element {
  const [prompts, setPrompts] = useState(props.prompts);
  const [rules, setRules] = useState(props.rules);
  const [models, setModels] = useState(props.models);

  if (props.mode === "models") {
    return <ModelsSection models={models} onModelsChange={setModels} />;
  }

  if (props.mode === "routing") {
    return <ModelRoutesSection routes={props.routes} models={models} />;
  }

  return (
    <PromptsRulesSection
      kind={props.mode}
      prompts={prompts}
      rules={rules}
      onPromptsChange={setPrompts}
      onRulesChange={setRules}
    />
  );
}
