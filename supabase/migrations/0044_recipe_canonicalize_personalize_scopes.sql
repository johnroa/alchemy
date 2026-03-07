-- 0044: Seed LLM scopes for recipe canonicalization and personalisation.
--
-- Two new scopes power the two-phase commit on recipe save:
--   recipe_canonicalize – strips user-specific adaptations to produce a public
--                         canonical recipe while preserving dish identity
--   recipe_personalize  – materialises a user's private variant from the canonical
--                         base + preferences + explicit edits
--
-- Both use gpt-4.1 for quality — these are high-stakes recipe transformations
-- that must preserve culinary correctness and dish identity.
--
-- Prompts are initial v1 templates. They will be refined via the Admin UI prompt
-- management workflow (prompt-list, prompt-create, prompt-activate) once we have
-- real usage data. Do not edit these directly after initial deployment.

-- ============================================================================
-- recipe_canonicalize scope
-- ============================================================================

-- Route: gpt-4.1 for quality. Canonicalization requires nuanced understanding
-- of what is "the dish" vs "the user's adaptation." Temperature 0.3 for
-- consistency — we want deterministic canonical output, not creative variation.
insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
values (
  'recipe_canonicalize',
  'openai_gpt-4.1',
  'openai',
  'gpt-4.1',
  '{"temperature": 0.3, "max_output_tokens": 4096, "timeout_ms": 30000}'::jsonb,
  true
)
on conflict (scope) where is_active = true
do update set
  route_name = excluded.route_name,
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config;

-- Prompt v1: canonicalization instructions.
insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values (
  'recipe_canonicalize',
  1,
  'recipe_canonicalize_v1',
  $$You are a recipe editor specialising in canonical recipe extraction.

You receive a PERSONALISED recipe that was generated for a specific user. Your job is to produce the CANONICAL version — the universal, public, shareable form of the same dish.

## What to strip (user-specific adaptations)

Remove adaptations that exist solely because of the user's profile:
- Equipment-specific adjustments (e.g. "reduce oven temp by 25°F for La Cornue" → use standard oven temps)
- Dietary substitutions driven by allergies/restrictions (e.g. rice pasta for gluten allergy → use the standard ingredient)
- Altitude adjustments (e.g. increased leavening for high altitude → use sea-level defaults)
- Household scaling (e.g. "doubled for family of 6" → use standard 4-serving baseline)
- Skill-level adjustments (e.g. simplified technique for beginners → use the standard technique)

## What to preserve (dish identity)

Keep everything that defines WHAT this dish IS:
- Title (never change the title)
- Core ingredients and technique
- Flavour profile and seasoning approach
- Cuisine and cultural context
- Cooking method and structure (sections, steps)
- Creative elements that make this recipe distinctive

## How to decide

Ask yourself: "If I removed the user from the equation, what would this recipe look like for anyone?" That's the canonical version.

If the personalised version IS the standard version (no user-specific adaptations detected), return it unchanged.

## Output

Return the canonical recipe as strict JSON matching the exact same schema as the input recipe payload. Every field present in the input must be present in the output.

Do NOT add commentary, markdown, or explanation. Output ONLY the JSON recipe payload.$$,
  '{"contract":"recipe_canonicalize_v1","strict_json":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

-- Rule v1: canonicalization guardrails.
insert into public.llm_rules (scope, version, name, rule, is_active)
values (
  'recipe_canonicalize',
  1,
  'recipe_canonicalize_rule_v1',
  '{
    "strict_json_only": true,
    "response_contract": "recipe_canonicalize_v1",
    "forbid_markdown": true,
    "must_preserve_title": true,
    "must_preserve_structure": true,
    "must_use_standard_techniques": true,
    "notes": "Output must be a complete recipe payload. Title must match input exactly. Structure (sections, steps) must be preserved. User-specific adaptations must be reverted to standard form."
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;

-- ============================================================================
-- recipe_personalize scope
-- ============================================================================

-- Route: gpt-4.1 for quality. Personalisation must be culinarily sound —
-- substitutions need to work in context. Temperature 0.4 allows slight
-- creativity in adaptation approach while staying grounded.
insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
values (
  'recipe_personalize',
  'openai_gpt-4.1',
  'openai',
  'gpt-4.1',
  '{"temperature": 0.4, "max_output_tokens": 4096, "timeout_ms": 30000}'::jsonb,
  true
)
on conflict (scope) where is_active = true
do update set
  route_name = excluded.route_name,
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config;

-- Prompt v1: personalisation instructions.
insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values (
  'recipe_personalize',
  1,
  'recipe_personalize_v1',
  $$You are a personal sous chef specialising in recipe adaptation.

You receive a CANONICAL recipe (the universal, public version) and a user's PREFERENCE PROFILE. Your job is to produce a PERSONALISED version tailored to this specific user.

## Inputs

1. **Canonical recipe**: the base recipe payload (JSON)
2. **User preferences**: structured profile including constraints and preferences
3. **Graph substitutions** (optional): known ingredient substitutions with confidence scores from the knowledge graph
4. **Manual edit instructions** (optional): explicit changes the user requested

## Adaptation rules

### Constraints (MUST apply — these are safety/equipment/environment requirements)
- Allergies and dietary restrictions: substitute or remove offending ingredients
- Equipment adaptations: adjust techniques, temperatures, and times for the user's actual equipment
- Religious/cultural rules: ensure compliance
- Kitchen environment: adjust for altitude, stove type, etc.
- Aversions: remove or substitute ingredients the user strongly dislikes

### Preferences (SHOULD consider — these influence but don't override)
- Dietary preferences (keto, low sugar, etc.): lean toward but don't force
- Cuisine affinities: adjust seasoning profile when natural
- Spice tolerance: calibrate heat levels
- Cooking style: adjust structure (one-pot, batch, etc.) when feasible
- Skill level: adjust technique complexity and instruction detail

### Manual edits (MUST apply exactly as requested)
If manual edit instructions are provided, apply them faithfully. These override both the canonical recipe and preference-driven adaptations.

## What to preserve
- Title: NEVER change the title. The personalised version IS the same dish.
- Dish identity: the recipe should still be recognisable as the same dish
- Structure: maintain the same sections and step flow unless a constraint requires restructuring

## Output format

Return strict JSON with two top-level keys:
1. "recipe": the personalised recipe payload (same schema as input)
2. "adaptation_summary": a 1-2 sentence natural language summary of what was adapted and why (this becomes the variant's summary paragraph)
3. "applied_adaptations": array of { "field": string, "type": "constraint"|"preference"|"manual", "description": string } documenting each change made
4. "tag_diff": { "added": string[], "removed": string[] } — tags that changed from the canonical version (e.g. added "gluten-free", removed "contains-gluten")

Do NOT add commentary, markdown, or explanation. Output ONLY the JSON.$$,
  '{"contract":"recipe_personalize_v1","strict_json":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

-- Rule v1: personalisation guardrails.
insert into public.llm_rules (scope, version, name, rule, is_active)
values (
  'recipe_personalize',
  1,
  'recipe_personalize_rule_v1',
  '{
    "strict_json_only": true,
    "response_contract": "recipe_personalize_v1",
    "required_keys": ["recipe", "adaptation_summary", "applied_adaptations", "tag_diff"],
    "forbid_markdown": true,
    "must_preserve_title": true,
    "must_apply_constraints": true,
    "notes": "Output must contain recipe payload, adaptation summary, applied adaptations list, and tag diff. Title must match canonical exactly. All constraint-category preferences must be applied. Manual edits override everything."
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
