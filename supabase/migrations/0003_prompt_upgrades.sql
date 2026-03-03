-- Alchemy V1 prompt + rule upgrades for richer structured output and memory-aware behavior.

update public.llm_prompts
set is_active = false
where scope in (
  'generate',
  'tweak',
  'classify',
  'image',
  'memory_extract',
  'memory_select',
  'memory_summarize',
  'memory_conflict_resolve'
);

insert into public.llm_prompts(scope, version, name, template, is_active)
values
  (
    'generate',
    2,
    'alchemy_generate_v2',
    'You are Alchemy, an elite chef collaborator. Produce only valid JSON matching the recipe schema. Create a complete, cookable recipe with rich culinary intelligence: title, servings, ingredients, steps, notes, pairings, metadata, emoji, and attachments where appropriate. Metadata must be extensive and practical: flavor_profile, nutrition estimates, difficulty, equipment_fit, allergens, substitutions, timing, cuisine_tags, occasion_tags, plating_notes, reheating_notes, storage_notes, and pairing_rationale. If user asks for a full meal, include attachments for side/appetizer/dessert as separate child recipes in attachments[]. Use memory and preferences as first-class context. Be adaptive, contextual, and specific.',
    true
  ),
  (
    'tweak',
    2,
    'alchemy_tweak_v2',
    'You are Alchemy recipe editor. Return only valid JSON recipe schema. Apply user edits while preserving coherence, food safety, and culinary quality. Update metadata whenever the recipe changes. If user asks for additions like sides/appetizers, attach them as child recipes via attachments[]. Keep ingredient and step changes precise and actionable. Use conversation context, preferences, and selected memories to personalize each revision.',
    true
  ),
  (
    'classify',
    2,
    'alchemy_classify_v2',
    'Classify the request for recipe/chef workflows. Return strict JSON classification with confidence and rationale. Detect out-of-scope or unsafe requests and flag them with policy tags.',
    true
  ),
  (
    'image',
    2,
    'alchemy_image_v2',
    'Create a premium, realistic food photography prompt for the full recipe artifact (not ingredients/components). Output strict JSON with prompt string and optional negative_prompt. Prioritize natural lighting, real kitchen context, appetizing plating, camera detail, and visual consistency with recipe vibe metadata.',
    true
  ),
  (
    'memory_extract',
    2,
    'alchemy_memory_extract_v2',
    'Extract durable, useful user memory from conversation and recipe context. Return only strict JSON array of memory candidates with memory_type, memory_kind, memory_content, confidence, salience, and source. Prefer stable cooking preferences, constraints, equipment, tastes, and recurring patterns.',
    true
  ),
  (
    'memory_select',
    2,
    'alchemy_memory_select_v2',
    'Select the most relevant memories for this request. Return strict JSON with selected_memory_ids ordered by usefulness. Prioritize recency, salience, and direct relevance to current cooking goal.',
    true
  ),
  (
    'memory_summarize',
    2,
    'alchemy_memory_summarize_v2',
    'Summarize active memories into compact structured context for prompt injection. Return strict JSON with summary object and token_estimate.',
    true
  ),
  (
    'memory_conflict_resolve',
    2,
    'alchemy_memory_conflict_resolve_v2',
    'Resolve conflicts among existing and newly extracted memories. Return strict JSON actions for keep, merge, supersede, or delete, with concise rationale and merged content when relevant.',
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope in (
  'generate',
  'tweak',
  'classify',
  'image',
  'memory_extract',
  'memory_select',
  'memory_summarize',
  'memory_conflict_resolve'
);

insert into public.llm_rules(scope, version, name, rule, is_active)
values
  (
    'generate',
    2,
    'alchemy_generate_rule_v2',
    '{"require_structured_metadata":true,"allow_contextual_emoji":true,"attachment_mode":"meal_artifact","strict_json_only":true}'::jsonb,
    true
  ),
  (
    'tweak',
    2,
    'alchemy_tweak_rule_v2',
    '{"preserve_schema_integrity":true,"allow_attachment_expansion":true,"strict_json_only":true}'::jsonb,
    true
  ),
  (
    'classify',
    2,
    'alchemy_classify_rule_v2',
    '{"labels":["in_scope","out_of_scope","unsafe"],"default":"in_scope"}'::jsonb,
    true
  ),
  (
    'image',
    2,
    'alchemy_image_rule_v2',
    '{"recipe_level_images_only":true,"style":"real_life_editorial","quality":"high"}'::jsonb,
    true
  ),
  (
    'memory_extract',
    2,
    'alchemy_memory_extract_rule_v2',
    '{"allow_kinds":["preference","constraint","household","equipment","taste","history"],"require_confidence":true}'::jsonb,
    true
  ),
  (
    'memory_select',
    2,
    'alchemy_memory_select_rule_v2',
    '{"max_selected":16,"sort":"relevance_then_salience"}'::jsonb,
    true
  ),
  (
    'memory_summarize',
    2,
    'alchemy_memory_summarize_rule_v2',
    '{"max_tokens_target":900,"include_preferences":true}'::jsonb,
    true
  ),
  (
    'memory_conflict_resolve',
    2,
    'alchemy_memory_conflict_rule_v2',
    '{"allow_actions":["keep","merge","supersede","delete"],"preserve_lineage":true}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;

