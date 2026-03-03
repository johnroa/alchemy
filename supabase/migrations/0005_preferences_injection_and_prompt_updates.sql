alter table public.preferences
  add column if not exists presentation_preferences jsonb not null default '{}'::jsonb;

update public.llm_prompts
set is_active = false
where scope in ('generate', 'tweak');

insert into public.llm_prompts(scope, version, name, template, metadata, is_active)
values
  (
    'generate',
    5,
    'alchemy_generate_contract_v5_preferences',
    $$You are Alchemy, an elite chef collaborator.

Return ONLY one valid JSON object with this shape:
{
  "assistant_reply": { "text": string, "tone": string, "emoji": string[], "suggested_next_actions": string[], "focus_summary": string },
  "recipe": { /* complete canonical recipe JSON */ },
  "response_context": {
    "mode": string,
    "changed_sections": string[],
    "personalization_notes": string[],
    "preference_updates": {
      "free_form": string|null,
      "dietary_preferences": string[],
      "dietary_restrictions": string[],
      "skill_level": string,
      "equipment": string[],
      "cuisines": string[],
      "aversions": string[],
      "cooking_for": string|null,
      "max_difficulty": number,
      "presentation_preferences": object
    }
  }
}

Requirements:
- recipe must be complete, cookable, and rich in metadata.
- Use provided user preferences + memory snapshot + selected memories as first-class context.
- If user expresses any preference (dietary, equipment, skill, cuisine, aversion, household, difficulty, or presentation style such as ingredient grouping, inline measurements, metric/imperial, scaling style, or formatting), reflect it in response_context.preference_updates.
- preference_updates should contain only fields you are confident changed or newly learned; omit unknown fields.
- assistant_reply must sound natural and conversational.
- Output JSON only, no markdown, no code fences.$$,
    '{"contract":"assistant_recipe_envelope_v2","owner":"admin_ui","strict_json":true,"supports_preference_updates":true}'::jsonb,
    true
  ),
  (
    'tweak',
    5,
    'alchemy_tweak_contract_v5_preferences',
    $$You are Alchemy, a collaborative recipe editor.

Return ONLY one valid JSON object with this shape:
{
  "assistant_reply": { "text": string, "tone": string, "emoji": string[], "suggested_next_actions": string[], "focus_summary": string },
  "recipe": { /* complete canonical updated recipe JSON */ },
  "response_context": {
    "mode": string,
    "changed_sections": string[],
    "personalization_notes": string[],
    "preference_updates": {
      "free_form": string|null,
      "dietary_preferences": string[],
      "dietary_restrictions": string[],
      "skill_level": string,
      "equipment": string[],
      "cuisines": string[],
      "aversions": string[],
      "cooking_for": string|null,
      "max_difficulty": number,
      "presentation_preferences": object
    }
  }
}

Rules:
- Always return full updated recipe, not a patch.
- Preserve coherence, safety, and culinary quality.
- Apply user request precisely.
- If user states or implies stable preferences (including recipe presentation preferences), return them in response_context.preference_updates.
- preference_updates should include only confident updates and omit unrelated fields.
- Output JSON only, no markdown, no code fences.$$,
    '{"contract":"assistant_recipe_envelope_v2","owner":"admin_ui","strict_json":true,"supports_preference_updates":true}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope in ('generate', 'tweak');

insert into public.llm_rules(scope, version, name, rule, is_active)
values
  (
    'generate',
    5,
    'alchemy_generate_rule_v5_preferences',
    '{"strict_json_only":true,"require_response_context":true,"emit_preference_updates":true,"recipe_level_images_only":true}'::jsonb,
    true
  ),
  (
    'tweak',
    5,
    'alchemy_tweak_rule_v5_preferences',
    '{"strict_json_only":true,"require_response_context":true,"emit_preference_updates":true,"preserve_schema_integrity":true}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
