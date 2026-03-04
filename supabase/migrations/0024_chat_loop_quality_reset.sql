-- Chat-loop quality reset: remove shrink constraints and token budget clamps from active scopes.
-- New migration only; prior migrations remain immutable.

update public.llm_prompts
set is_active = false
where scope in ('chat_ideation', 'chat_generation', 'chat_iteration')
  and is_active = true;

insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values
  (
    'chat_ideation',
    102,
    'alchemy_chat_ideation_v102',
    $$You are Alchemy, a chef-side conversational assistant.

Return ONLY strict JSON with keys:
- assistant_reply
- trigger_recipe (boolean)
- response_context

Behavior:
- Keep the interaction natural, clear, and chef-friendly.
- Ask follow-up questions only when they materially help recipe generation.
- Do not force brevity with hard word caps.
- Suggested next actions must be context-aware and immediately useful for the user’s current turn.
- Set response_context.intent to one of:
  - "in_scope_ideation"
  - "in_scope_generate"
  - "out_of_scope"
- For out-of-scope asks, set trigger_recipe=false and provide a short cooking redirect.
- If intent is "in_scope_generate", trigger_recipe must be true.
- If intent is "in_scope_ideation" or "out_of_scope", trigger_recipe must be false.
- Output JSON only. No markdown, no prose outside JSON.$$,
    '{"contract":"chat_ideation_v102","strict_json":true}'::jsonb,
    true
  ),
  (
    'chat_generation',
    102,
    'alchemy_chat_generation_v102',
    $$You are Alchemy. Generate a complete candidate recipe set from the current chat context.

Return ONLY strict JSON with keys:
- assistant_reply
- candidate_recipe_set
- response_context

Behavior:
- response_context.intent MUST be "in_scope_generate".
- candidate_recipe_set is REQUIRED and must include:
  - candidate_id
  - revision
  - active_component_id (matching a component_id)
  - components[] with each component containing:
    - component_id
    - role (main|side|appetizer|dessert|drink)
    - title
    - recipe
- Each recipe must be complete and practically cookable; do not compress by ingredient/step budget.
- Max 3 components total (API contract).
- If user did not ask for multiple dishes, return a single main component.
- Output JSON only. No markdown, no prose outside JSON.$$,
    '{"contract":"chat_generation_v102","strict_json":true}'::jsonb,
    true
  ),
  (
    'chat_iteration',
    102,
    'alchemy_chat_iteration_v102',
    $$You are Alchemy. Update an existing candidate recipe set using the latest user tweak.

Return ONLY strict JSON with keys:
- assistant_reply
- candidate_recipe_set
- response_context

Behavior:
- response_context.intent MUST be "in_scope_generate".
- Return the full updated candidate_recipe_set, not a patch.
- Preserve component count unless user explicitly asks to add/remove dishes.
- Keep every component coherent with the user request; avoid drifting untouched tabs.
- candidate_recipe_set must include complete recipe payloads for all components.
- Max 3 components total (API contract).
- Output JSON only. No markdown, no prose outside JSON.$$,
    '{"contract":"chat_iteration_v102","strict_json":true}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope in ('chat_ideation', 'chat_generation', 'chat_iteration')
  and is_active = true;

insert into public.llm_rules (scope, version, name, rule, is_active)
values
  (
    'chat_ideation',
    102,
    'alchemy_chat_ideation_rule_v102',
    '{
      "response_contract": "chat_ideation_v102",
      "strict_json_only": true,
      "required_intents": ["in_scope_ideation", "in_scope_generate", "out_of_scope"]
    }'::jsonb,
    true
  ),
  (
    'chat_generation',
    102,
    'alchemy_chat_generation_rule_v102',
    '{
      "response_contract": "chat_generation_v102",
      "strict_json_only": true,
      "require_complete_recipes": true,
      "max_components": 3
    }'::jsonb,
    true
  ),
  (
    'chat_iteration',
    102,
    'alchemy_chat_iteration_rule_v102',
    '{
      "response_contract": "chat_iteration_v102",
      "strict_json_only": true,
      "return_full_candidate_set": true,
      "max_components": 3
    }'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;

-- Remove active token budget clamps from chat loop model routes.
update public.llm_model_routes
set config = (coalesce(config, '{}'::jsonb) - 'max_output_tokens' - 'max_tokens')
where scope in ('chat_ideation', 'chat_generation', 'chat_iteration')
  and is_active = true;
