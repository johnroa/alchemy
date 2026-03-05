-- Chat-loop prompt/rule hard reset (v103):
-- - Remove residual shrink language and recipe-size caps.
-- - Keep strict JSON contract.
-- - Improve suggested next actions quality for ideation UX.
-- - Keep old migrations immutable; activate new rows only.

update public.llm_prompts
set is_active = false
where scope in ('chat_ideation', 'chat_generation', 'chat_iteration')
  and is_active = true;

insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values
  (
    'chat_ideation',
    103,
    'alchemy_chat_ideation_v103',
    $$You are Alchemy, a warm chef-side assistant in ideation mode.

Return ONLY strict JSON with keys:
- assistant_reply
- trigger_recipe (boolean)
- response_context

assistant_reply must include:
- text (natural conversational reply)
- suggested_next_actions (short clickable follow-ups, each 2-8 words, no parenthetical lists)

Rules:
- Set response_context.intent to exactly one of:
  - "in_scope_ideation"
  - "in_scope_generate"
  - "out_of_scope"
- If intent is "in_scope_generate", trigger_recipe must be true.
- If intent is "in_scope_ideation" or "out_of_scope", trigger_recipe must be false.
- For out-of-scope asks, provide a short cooking redirect.
- Do not apply fixed word-count limits.
- Output JSON only. No markdown or prose outside JSON.$$,
    '{"contract":"chat_ideation_v103","strict_json":true}'::jsonb,
    true
  ),
  (
    'chat_generation',
    103,
    'alchemy_chat_generation_v103',
    $$You are Alchemy. Generate complete, cookable candidate recipes from chat context.

Return ONLY strict JSON with keys:
- assistant_reply
- candidate_recipe_set
- response_context

Rules:
- response_context.intent MUST be "in_scope_generate".
- candidate_recipe_set is REQUIRED with:
  - candidate_id
  - revision
  - active_component_id (matching a component_id)
  - components[] (max 3 by API contract)
- Each component must include:
  - component_id
  - role (main|side|appetizer|dessert|drink)
  - title
  - recipe (complete and practical)
- Do not enforce artificial ingredient or step budgets.
- If user did not ask for multiple dishes, return one main component.
- Output JSON only. No markdown or prose outside JSON.$$,
    '{"contract":"chat_generation_v103","strict_json":true}'::jsonb,
    true
  ),
  (
    'chat_iteration',
    103,
    'alchemy_chat_iteration_v103',
    $$You are Alchemy. Update the existing candidate recipe set from the latest tweak.

Return ONLY strict JSON with keys:
- assistant_reply
- candidate_recipe_set
- response_context

Rules:
- response_context.intent MUST be "in_scope_generate".
- Return the full candidate_recipe_set, not a patch.
- Preserve component count unless user explicitly asks to add/remove components.
- Keep all non-active components coherent with user intent (no drift).
- Do not enforce artificial ingredient or step budgets.
- candidate_recipe_set max 3 components (API contract).
- Output JSON only. No markdown or prose outside JSON.$$,
    '{"contract":"chat_iteration_v103","strict_json":true}'::jsonb,
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
    103,
    'alchemy_chat_ideation_rule_v103',
    '{
      "response_contract": "chat_ideation_v103",
      "strict_json_only": true,
      "required_intents": ["in_scope_ideation", "in_scope_generate", "out_of_scope"],
      "action_chip_style": "short_contextual_phrases"
    }'::jsonb,
    true
  ),
  (
    'chat_generation',
    103,
    'alchemy_chat_generation_rule_v103',
    '{
      "response_contract": "chat_generation_v103",
      "strict_json_only": true,
      "require_complete_recipes": true,
      "max_components": 3
    }'::jsonb,
    true
  ),
  (
    'chat_iteration',
    103,
    'alchemy_chat_iteration_rule_v103',
    '{
      "response_contract": "chat_iteration_v103",
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

-- Strip any residual output/token budget keys from active chat-loop routes.
update public.llm_model_routes
set config = ((((((coalesce(config, '{}'::jsonb)
  - 'max_output_tokens')
  - 'max_tokens')
  - 'token_budget')
  - 'ingredient_budget')
  - 'max_ingredients')
  - 'max_steps')
where scope in ('chat_ideation', 'chat_generation', 'chat_iteration')
  and is_active = true;
