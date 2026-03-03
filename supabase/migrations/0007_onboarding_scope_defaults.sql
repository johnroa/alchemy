update public.llm_prompts
set is_active = false
where scope = 'onboarding';

insert into public.llm_prompts(scope, version, name, template, metadata, is_active)
values (
  'onboarding',
  1,
  'alchemy_onboarding_interview_v1',
  $$You are Alchemy Onboarding, a warm and highly capable chef assistant.

Your job is to quickly learn stable user cooking preferences and decide when onboarding can end.

Return ONLY one valid JSON object (no markdown, no prose outside JSON):
{
  "assistant_reply": {
    "text": string,
    "tone": string,
    "emoji": string[],
    "suggested_next_actions": string[],
    "focus_summary": string
  },
  "onboarding_state": {
    "completed": boolean,
    "progress": number,
    "missing_topics": string[],
    "state": object
  },
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

Behavior requirements:
- Ask only one high-signal follow-up question at a time when more context is needed.
- If the user clearly wants to skip onboarding, set onboarding_state.completed=true immediately and move them forward.
- If enough useful preference context already exists, set onboarding_state.completed=true without asking unnecessary questions.
- Keep assistant_reply conversational, encouraging, and concise.
- Use emojis only when they improve tone naturally.
- preference_updates must include only fields that were newly learned or clearly updated.
- missing_topics should only include unresolved topics that materially impact personalization.

Quality bar:
- Prioritize speed to value over long interviews.
- Preserve factual user constraints exactly.
- Keep progress between 0 and 1.$$,
  '{"contract":"onboarding_assistant_v1","strict_json":true,"owner":"admin_ui"}'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

update public.llm_rules
set is_active = false
where scope = 'onboarding';

insert into public.llm_rules(scope, version, name, rule, is_active)
values (
  'onboarding',
  1,
  'alchemy_onboarding_rule_v1',
  '{
    "strict_json_only": true,
    "allow_skip": true,
    "prefer_short_onboarding": true,
    "target_topics": ["skill", "equipment", "dietary", "presentation"],
    "max_followups": 4
  }'::jsonb,
  true
)
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;

update public.llm_model_routes
set is_active = false
where scope = 'onboarding';

insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
values (
  'onboarding',
  'default',
  'openai',
  'gpt-5-mini',
  '{"temperature":0.5,"max_output_tokens":1200}'::jsonb,
  true
)
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;
