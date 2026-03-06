-- Add explicit image billing metadata and seed image quality evaluation scope.

alter table public.llm_model_registry
  add column if not exists billing_mode text not null default 'token';

alter table public.llm_model_registry
  add column if not exists billing_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'llm_model_registry_billing_mode_check'
  ) then
    alter table public.llm_model_registry
      add constraint llm_model_registry_billing_mode_check
      check (billing_mode in ('token', 'image'));
  end if;
end
$$;

update public.llm_model_registry
set billing_mode = 'token',
    billing_metadata = '{}'::jsonb,
    updated_at = now()
where billing_mode is distinct from 'token'
   or billing_metadata is null;

update public.llm_model_registry
set billing_mode = 'image',
    billing_metadata = jsonb_build_object(
      'pricing_type', 'openai_image_quality_size',
      'default_quality', 'high',
      'default_size', '1536x1024',
      'image_rates_usd', jsonb_build_object(
        'low', jsonb_build_object(
          '1024x1024', 0.011,
          '1536x1024', 0.016,
          '1024x1536', 0.016
        ),
        'medium', jsonb_build_object(
          '1024x1024', 0.042,
          '1536x1024', 0.063,
          '1024x1536', 0.063
        ),
        'high', jsonb_build_object(
          '1024x1024', 0.167,
          '1536x1024', 0.250,
          '1024x1536', 0.250
        )
      )
    ),
    output_cost_per_1m_tokens = 0,
    updated_at = now()
where provider = 'openai'
  and model in ('gpt-image-1.5', 'gpt-image-1');

update public.llm_model_registry
set billing_mode = 'image',
    billing_metadata = jsonb_build_object(
      'pricing_type', 'flat_image',
      'cost_per_image_usd', 0.039
    ),
    output_cost_per_1m_tokens = 0,
    updated_at = now()
where provider = 'google'
  and model = 'gemini-2.5-flash-image';

update public.llm_model_routes
set is_active = false
where scope = 'image_quality_eval'
  and is_active = true;

insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
values (
  'image_quality_eval',
  'image_quality_eval_default',
  'openai',
  'gpt-4.1-mini',
  '{"temperature":0.1,"max_output_tokens":256}'::jsonb,
  true
)
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

update public.llm_prompts
set is_active = false
where scope = 'image_quality_eval'
  and is_active = true;

insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values (
  'image_quality_eval',
  1,
  'image_quality_eval_v1',
  $$You are Alchemy's pairwise food image evaluator.

Compare two images of the same dish scenario and return ONLY one strict JSON object:
{
  "winner": "A" | "B" | "tie",
  "rationale": string,
  "confidence": number
}

Evaluation rules:
- Judge only visual quality and fidelity to the provided scenario.
- Prioritize appetizing realism, plating coherence, believable texture, lighting, composition, and ingredient clarity.
- Ignore generation speed and cost. Those are tracked separately.
- Use "tie" when the images are materially equal.
- Keep rationale concise and specific. No markdown or code fences.$$,
  '{"contract":"image_quality_eval_v1","strict_json":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope = 'image_quality_eval'
  and is_active = true;

insert into public.llm_rules (scope, version, name, rule, is_active)
values (
  'image_quality_eval',
  1,
  'image_quality_eval_rule_v1',
  '{"response_contract":"image_quality_eval_v1","strict_json_only":true,"allowed_winners":["A","B","tie"]}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
