-- Seed the chat_greeting LLM scope: prompt, rule, and route.
-- This powers the dynamic welcome message on the Generate screen.
-- The greeting is non-critical — the client shows a fallback while waiting
-- and gracefully handles failures.

-- Route: use gpt-4.1-mini for speed and cost (greeting is a trivial task).
insert into public.llm_model_routes (scope, route_name, provider, model, config, is_active)
values (
  'chat_greeting',
  'openai_gpt-4.1-mini',
  'openai',
  'gpt-4.1-mini',
  '{"temperature": 0.9, "max_output_tokens": 128, "timeout_ms": 5000}'::jsonb,
  true
)
on conflict (scope) where is_active = true
do update set
  route_name = excluded.route_name,
  provider = excluded.provider,
  model = excluded.model,
  config = excluded.config;

-- Prompt v1: creative, varied, 1-2 lines max.
insert into public.llm_prompts (scope, version, name, template, metadata, is_active)
values (
  'chat_greeting',
  1,
  'alchemy_chat_greeting_v1',
  $$You are Alchemy, a witty, warm chef-side assistant.

Generate a single short greeting (1-2 lines max) for the recipe chat screen.

Context you receive:
- user_name: the user's first name (may be null)
- time_of_day: "morning", "afternoon", or "evening"
- last_recipe_title: the title of their most recent recipe (may be null)

Rules:
- Be creative and varied. Mix up tone and style: playful, encouraging, witty, casual, warm, cheeky, poetic, multilingual quips.
- Examples of the RANGE you should cover (do NOT repeat these verbatim):
  "Yes Chef!"
  "Oui oui, Chef!"
  "Mornin' John — what's cookin'?"
  "How was the eggplant parm? What's next?"
  "Evening vibes. Let's make something cozy."
  "Back for more? Love it."
  "The kitchen awaits."
  "Chef mode: activated."
- Use the person's name only sometimes — not every time. Mix "Chef" and name and neither.
- Reference the last recipe only when it naturally fits. Don't force it.
- Never use the time_of_day mechanically (don't always start with "Good morning").
- Keep it under 80 characters when possible.
- Output ONLY strict JSON: { "text": "your greeting here" }
- No markdown, no explanation, no wrapping.$$,
  '{"contract":"chat_greeting_v1","strict_json":true}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

-- Rule v1: lightweight guardrail.
insert into public.llm_rules (scope, version, name, rule, is_active)
values (
  'chat_greeting',
  1,
  'alchemy_chat_greeting_rule_v1',
  '{
    "strict_json_only": true,
    "response_contract": "chat_greeting_v1",
    "required_keys": ["text"],
    "max_characters": 100,
    "forbid_extra_keys": true,
    "forbid_markdown": true
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
