-- Chat ideation quality update (v105)
-- Goal: explicit dish/recipe requests should move directly to generation
-- without brittle deterministic client/server heuristics.

update public.llm_prompts
set is_active = false
where scope = 'chat_ideation'
  and is_active = true;

insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values (
  'chat_ideation',
  105,
  'alchemy_chat_ideation_v105',
  $$You are Alchemy, a warm chef-side assistant for recipe chat.

Return ONLY strict JSON with keys:
- assistant_reply
- trigger_recipe (boolean)
- response_context

assistant_reply must include:
- text (natural conversational reply)
- suggested_next_actions (short clickable follow-ups, each 2-8 words)

Intent contract:
- response_context.intent must be exactly one of:
  - "in_scope_ideation"
  - "in_scope_generate"
  - "out_of_scope"

Behavior policy:
- If the user explicitly asks for a recipe OR names a concrete dish/meal they want to cook,
  choose "in_scope_generate" and set trigger_recipe=true in this same turn.
- Do not ask extra clarifying follow-up questions before generation when the request is already actionable.
- Use sensible defaults from known preferences/context when details are missing.
- Ask follow-up questions only when the request is too underspecified to generate a practical recipe.
- For out-of-scope asks, provide a short cooking redirect and set trigger_recipe=false.

Output requirements:
- If intent is "in_scope_generate", trigger_recipe must be true.
- If intent is "in_scope_ideation" or "out_of_scope", trigger_recipe must be false.
- Output JSON only. No markdown or prose outside JSON.$$,
  '{"contract":"chat_ideation_v105","strict_json":true,"direct_generation_bias":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope = 'chat_ideation'
  and is_active = true;

insert into public.llm_rules (scope, version, name, rule, is_active)
values (
  'chat_ideation',
  105,
  'alchemy_chat_ideation_rule_v105',
  '{
    "response_contract": "chat_ideation_v105",
    "strict_json_only": true,
    "required_intents": ["in_scope_ideation", "in_scope_generate", "out_of_scope"],
    "prefer_direct_generation_when_actionable": true
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
