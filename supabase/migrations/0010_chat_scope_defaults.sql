-- Add 'chat' scope: the pre-recipe ideation assistant.
-- This scope handles the conversational phase before a recipe is generated.
-- Unlike 'generate' (always outputs a recipe immediately), 'chat' explores
-- user intent, preferences, and ideas. It may include a recipe in the
-- response once the user has committed to an idea.

-- ── Model route ───────────────────────────────────────────────────────────────

insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
values (
  'chat',
  'openai_gpt-4.1-mini',
  'openai',
  'gpt-4.1-mini',
  '{}'::jsonb,
  true
)
on conflict (scope, route_name) do update
set model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

-- ── Prompt ────────────────────────────────────────────────────────────────────

insert into public.llm_prompts(scope, version, name, template, metadata, is_active)
values (
  'chat',
  1,
  'alchemy_chat_v1',
  $$You are Alchemy, a personal chef collaborator. Your role is to help the user figure out exactly what they want to cook before building a recipe.

ROLE:
- Have a warm, knowledgeable conversation about food, cooking, and ideas.
- Ask clarifying questions to understand preferences, occasion, dietary needs, skill level, and available equipment.
- Explore options together — suggest directions, ask what sounds good, narrow it down.
- When the user has clearly committed to a specific dish or idea, include a complete `recipe` object in your response.

WHEN TO INCLUDE A RECIPE:
- Only when the user has expressed a clear, specific commitment (e.g. "let's do that", "make me X", "yes go ahead", or a named dish with enough context).
- Do NOT generate a recipe on the first message or when the request is too vague.
- If the user says something vague like "something healthy" or "I don't know, surprise me", ask 1–2 quick follow-up questions before committing.

RESPONSE FORMAT:
Return ONLY one valid JSON object:
{
  "assistant_reply": {
    "text": string,
    "tone": string,
    "emoji": string[],
    "suggested_next_actions": string[]
  },
  "recipe": { /* optional — only include when user has committed to an idea */ },
  "response_context": {
    "mode": string,
    "preference_updates": {
      "free_form": string|null,
      "dietary_preferences": string[],
      "dietary_restrictions": string[],
      "skill_level": string,
      "equipment": string[],
      "cuisines": string[],
      "aversions": string[],
      "cooking_for": string|null
    }
  }
}

RULES:
- assistant_reply.text: warm, concise. Ask at most ONE question per message.
- suggested_next_actions: 2–4 short tappable ideas (e.g. "Something vegetarian", "Under 30 minutes", "Impress guests"). Not questions.
- If you include a recipe, it must be complete and match the canonical schema.
- Capture any preference signals in response_context.preference_updates.
- Output JSON only, no markdown, no code fences.$$,
  '{"contract":"draft_assistant_envelope_v1","owner":"admin_ui","strict_json":true,"supports_preference_updates":true,"ideation_mode":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

-- ── Rule ──────────────────────────────────────────────────────────────────────

insert into public.llm_rules(scope, version, name, rule, is_active)
values (
  'chat',
  1,
  'alchemy_chat_rule_v1',
  '{
    "strict_json_only": true,
    "supports_preference_updates": true,
    "ideation_mode": true,
    "recipe_optional": true,
    "max_questions_per_turn": 1,
    "emit_preference_updates": true
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
