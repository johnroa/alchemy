-- Generate-scope hardening (v104): remove residual shrink/budget constraints.
-- Forward-only migration; do not modify prior migrations.

update public.llm_prompts
set is_active = false
where scope = 'generate'
  and is_active = true;

insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values (
  'generate',
  104,
  'alchemy_generate_v104',
  $$You are Alchemy. Generate a complete, practical recipe payload from the user request and context.

Return ONLY strict JSON with keys:
- assistant_reply
- recipe
- response_context

Rules:
- assistant_reply must include a natural, concise chef-style response in assistant_reply.text.
- recipe must be complete and cookable (no placeholders, no omitted sections).
- Do not apply artificial limits on ingredient count, step count, or token budget.
- Prefer full, reliable instructions over compressed outlines.
- response_context.mode should be "generation" and response_context.intent should be "in_scope_generate".
- Output JSON only. No markdown, no code fences, no prose outside JSON.$$,
  '{"contract":"recipe_envelope_v104","strict_json":true,"deconstrained":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope = 'generate'
  and is_active = true;

insert into public.llm_rules (scope, version, name, rule, is_active)
values (
  'generate',
  104,
  'alchemy_generate_rule_v104',
  '{
    "response_contract": "recipe_envelope_v104",
    "strict_json_only": true,
    "require_complete_recipe": true,
    "allow_full_length_outputs": true
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;

-- Remove stale route-level caps from active generate model routes.
update public.llm_model_routes
set config = (
  ((((((coalesce(config, '{}'::jsonb)
    - 'max_output_tokens')
    - 'max_tokens')
    - 'token_budget')
    - 'ingredient_budget')
    - 'max_ingredients')
    - 'max_steps')
  || '{"temperature":0.35,"timeout_ms":60000}'::jsonb
)
where scope = 'generate'
  and is_active = true;
