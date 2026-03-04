-- Split generic classify helper calls into explicit DB-managed scopes.
-- This keeps prompt/rule/model management centralized via Admin API/UI.

with target_scopes(scope, route_name) as (
  values
    ('ingredient_alias_normalize', 'ingredient_alias_normalize_default'),
    ('ingredient_phrase_split', 'ingredient_phrase_split_default'),
    ('ingredient_enrich', 'ingredient_enrich_default'),
    ('recipe_metadata_enrich', 'recipe_metadata_enrich_default'),
    ('ingredient_relation_infer', 'ingredient_relation_infer_default'),
    ('preference_normalize', 'preference_normalize_default'),
    ('equipment_filter', 'equipment_filter_default')
),
active_classify_route as (
  select provider, model, config
  from public.llm_model_routes
  where scope = 'classify' and is_active = true
  order by created_at desc
  limit 1
)
update public.llm_model_routes
set is_active = false
where scope in (
  'ingredient_alias_normalize',
  'ingredient_phrase_split',
  'ingredient_enrich',
  'recipe_metadata_enrich',
  'ingredient_relation_infer',
  'preference_normalize',
  'equipment_filter'
)
  and is_active = true;

insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
select
  ts.scope,
  ts.route_name,
  coalesce(ar.provider, 'openai') as provider,
  coalesce(ar.model, 'gpt-4.1-mini') as model,
  coalesce(ar.config, '{}'::jsonb) as config,
  true
from (
  values
    ('ingredient_alias_normalize', 'ingredient_alias_normalize_default'),
    ('ingredient_phrase_split', 'ingredient_phrase_split_default'),
    ('ingredient_enrich', 'ingredient_enrich_default'),
    ('recipe_metadata_enrich', 'recipe_metadata_enrich_default'),
    ('ingredient_relation_infer', 'ingredient_relation_infer_default'),
    ('preference_normalize', 'preference_normalize_default'),
    ('equipment_filter', 'equipment_filter_default')
) as ts(scope, route_name)
left join active_classify_route ar on true
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

update public.llm_prompts
set is_active = false
where scope in (
  'ingredient_alias_normalize',
  'ingredient_phrase_split',
  'ingredient_enrich',
  'recipe_metadata_enrich',
  'ingredient_relation_infer',
  'preference_normalize',
  'equipment_filter'
)
  and is_active = true;

insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values
  (
    'ingredient_alias_normalize',
    1,
    'ingredient_alias_normalize_v1',
    $$You normalize ingredient aliases for a recipe app.
Return ONLY a JSON object with key "items" (array of objects).
Each object must include: alias_key (string), canonical_name (string), confidence (number 0..1).
Requirements:
- Collapse superficial spelling/punctuation variants.
- Keep meaningful ingredient identity qualifiers.
- Do not invent ingredients.
- Return at most one object per alias_key.
- JSON only, no markdown.$$,
    '{"contract":"ingredient_alias_normalize_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'ingredient_phrase_split',
    1,
    'ingredient_phrase_split_v1',
    $$Split ingredient phrases into atomic ingredients for normalization.
Return ONLY JSON with key "items". Each item:
{"source_name": string, "items": [{"name": string, "confidence": number}]}
Requirements:
- Preserve meaning and qualifiers.
- If already atomic, return one item equal to source phrase.
- Max 4 split items per source phrase.
- JSON only, no markdown.$$,
    '{"contract":"ingredient_phrase_split_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'ingredient_enrich',
    1,
    'ingredient_enrich_v1',
    $$Enrich canonical ingredients with structured food metadata.
Return ONLY JSON object with key "items".
Each item must include canonical_name, confidence, metadata, ontology_terms.
Keep confidence conservative and avoid unsupported claims.
JSON only, no markdown.$$,
    '{"contract":"ingredient_enrich_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'recipe_metadata_enrich',
    1,
    'recipe_metadata_enrich_v1',
    $$Enrich a recipe with strict structured metadata.
Return ONLY JSON object with keys: confidence, metadata.
Keep confidence conservative and avoid unsupported claims.
JSON only, no markdown.$$,
    '{"contract":"recipe_metadata_enrich_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'ingredient_relation_infer',
    1,
    'ingredient_relation_infer_v1',
    $$Infer semantic ingredient relations for a recipe graph.
Return ONLY JSON object with key "items".
Allowed relation_type: complements, substitutes_for, same_family_as, derived_from, conflicts_with.
Use only provided ingredients.
JSON only, no markdown.$$,
    '{"contract":"ingredient_relation_infer_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'preference_normalize',
    1,
    'preference_normalize_v1',
    $$Normalize user profile inputs for a recipe app.
Return ONLY JSON object with key "items" (array of strings).
Keep intent, preserve qualifiers, remove duplicates, max 32 items.
JSON only, no markdown.$$,
    '{"contract":"preference_normalize_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'equipment_filter',
    1,
    'equipment_filter_v1',
    $$Validate durable kitchen equipment preference updates.
Return ONLY JSON object with key "items" (array of strings).
Keep only equipment explicitly stated by the user; do not infer.
JSON only, no markdown.$$,
    '{"contract":"equipment_filter_v1","strict_json":true}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope in (
  'ingredient_alias_normalize',
  'ingredient_phrase_split',
  'ingredient_enrich',
  'recipe_metadata_enrich',
  'ingredient_relation_infer',
  'preference_normalize',
  'equipment_filter'
)
  and is_active = true;

insert into public.llm_rules (scope, version, name, rule, is_active)
values
  (
    'ingredient_alias_normalize',
    1,
    'ingredient_alias_normalize_rule_v1',
    '{"response_contract":"ingredient_alias_normalize_v1","strict_json_only":true}'::jsonb,
    true
  ),
  (
    'ingredient_phrase_split',
    1,
    'ingredient_phrase_split_rule_v1',
    '{"response_contract":"ingredient_phrase_split_v1","strict_json_only":true,"max_split_items":4}'::jsonb,
    true
  ),
  (
    'ingredient_enrich',
    1,
    'ingredient_enrich_rule_v1',
    '{"response_contract":"ingredient_enrich_v1","strict_json_only":true}'::jsonb,
    true
  ),
  (
    'recipe_metadata_enrich',
    1,
    'recipe_metadata_enrich_rule_v1',
    '{"response_contract":"recipe_metadata_enrich_v1","strict_json_only":true}'::jsonb,
    true
  ),
  (
    'ingredient_relation_infer',
    1,
    'ingredient_relation_infer_rule_v1',
    '{"response_contract":"ingredient_relation_infer_v1","strict_json_only":true}'::jsonb,
    true
  ),
  (
    'preference_normalize',
    1,
    'preference_normalize_rule_v1',
    '{"response_contract":"preference_normalize_v1","strict_json_only":true,"max_items":32}'::jsonb,
    true
  ),
  (
    'equipment_filter',
    1,
    'equipment_filter_rule_v1',
    '{"response_contract":"equipment_filter_v1","strict_json_only":true,"max_items":32}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;

-- Keep classify scope active for compatibility paths; helper calls now use explicit scopes.
