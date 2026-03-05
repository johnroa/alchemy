-- Add explicit ingredient_line_parse scope for structured line decomposition.

update public.llm_model_routes
set is_active = false
where scope = 'ingredient_line_parse'
  and is_active = true;

insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
select
  'ingredient_line_parse',
  'ingredient_line_parse_default',
  coalesce(ar.provider, 'anthropic'),
  coalesce(ar.model, 'claude-haiku-4-5'),
  coalesce(ar.config, '{}'::jsonb),
  true
from (values (1)) as seed(x)
left join lateral (
  select provider, model, config
  from public.llm_model_routes
  where scope = 'classify' and is_active = true
  order by created_at desc
  limit 1
) ar on true
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

update public.llm_prompts
set is_active = false
where scope = 'ingredient_line_parse'
  and is_active = true;

insert into public.llm_prompts(scope, version, name, template, metadata, is_active)
values (
  'ingredient_line_parse',
  1,
  'ingredient_line_parse_v1',
  $$You parse recipe ingredient source lines into structured semantic objects.
Return ONLY one JSON object with key "items".
Each item must be:
{
  "source_name": string,
  "line_confidence": number,
  "mentions": [
    {
      "name": string,
      "role": "primary"|"optional"|"alternative"|"garnish"|"unspecified",
      "alternative_group_key": string|null,
      "confidence": number
    }
  ],
  "qualifiers": [
    {
      "term_type": "preparation"|"state"|"quality"|"size"|"purpose"|"temperature"|"treatment",
      "term_key": string,
      "label": string,
      "relation_type": "prepared_as"|"has_state"|"has_quality"|"has_size"|"has_purpose"|"has_temperature"|"has_treatment",
      "target": "line"|number,
      "confidence": number
    }
  ]
}
Rules:
- Canonical mention names should represent edible ingredient identity, not prep modifiers.
- Keep core ingredient qualifiers in mention name only when identity changes (e.g., chicken breast, olive oil).
- Put prep/state/freshness/chopped/sliced/minced/deveined/frozen/canned in qualifiers.
- For alternatives ("A or B"), emit separate mentions with shared alternative_group_key.
- Max 6 mentions per line, max 10 qualifiers per line.
- Keep confidence conservative. No markdown.$$,
  '{"contract":"ingredient_line_parse_v1","strict_json":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope = 'ingredient_line_parse'
  and is_active = true;

insert into public.llm_rules(scope, version, name, rule, is_active)
values (
  'ingredient_line_parse',
  1,
  'ingredient_line_parse_rule_v1',
  '{"response_contract":"ingredient_line_parse_v1","strict_json_only":true,"max_items":256}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
