-- Dev-only: chat-loop hard cutover support
-- Adds async memory job queue and new chat loop prompt scopes.

create table if not exists public.memory_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  chat_id uuid not null references public.chat_sessions(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  interaction_context jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, message_id)
);

create index if not exists memory_jobs_poll_idx
  on public.memory_jobs(status, next_attempt_at asc);
create index if not exists memory_jobs_user_idx
  on public.memory_jobs(user_id, updated_at desc);
create index if not exists memory_jobs_chat_idx
  on public.memory_jobs(chat_id, created_at asc);

alter table public.memory_jobs enable row level security;

drop policy if exists memory_jobs_owner_rw on public.memory_jobs;
create policy memory_jobs_owner_rw on public.memory_jobs
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists memory_jobs_owner_read on public.memory_jobs;
create policy memory_jobs_owner_read on public.memory_jobs
  for select
  using (user_id = auth.uid());

-- New chat loop scopes: ideation, generation, iteration.
insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
select
  'chat_ideation',
  'chat_ideation_default',
  provider,
  model,
  config,
  true
from public.llm_model_routes
where scope = 'chat' and is_active = true
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
select
  'chat_generation',
  'chat_generation_default',
  provider,
  model,
  config,
  true
from public.llm_model_routes
where scope = 'chat' and is_active = true
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

insert into public.llm_model_routes(scope, route_name, provider, model, config, is_active)
select
  'chat_iteration',
  'chat_iteration_default',
  provider,
  model,
  config,
  true
from public.llm_model_routes
where scope = 'chat' and is_active = true
on conflict (scope, route_name) do update
set provider = excluded.provider,
    model = excluded.model,
    config = excluded.config,
    is_active = excluded.is_active;

insert into public.llm_prompts(scope, version, name, template, metadata, is_active)
values
  (
    'chat_ideation',
    1,
    'alchemy_chat_ideation_v1',
    $$You are Alchemy, a concise cooking copilot.

Goal for this turn:
1) Briefly guide the user and infer preferences.
2) Decide whether to trigger recipe generation now.

Return ONLY strict JSON:
{
  "assistant_reply": {
    "text": string,
    "tone": string,
    "emoji": string[],
    "suggested_next_actions": string[]
  },
  "trigger_recipe": boolean,
  "response_context": {
    "mode": "ideation",
    "preference_updates": object
  }
}

Rules:
- Keep assistant_reply.text short and practical.
- Ask at most one question.
- Set trigger_recipe=true only when user intent is specific enough to generate now.
- Output JSON only.$$,
    '{"contract":"chat_ideation_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'chat_generation',
    1,
    'alchemy_chat_generation_v1',
    $$You are Alchemy. Generate candidate recipe tabs from the current chat context.

Return ONLY strict JSON:
{
  "assistant_reply": {
    "text": string,
    "tone": string,
    "emoji": string[],
    "suggested_next_actions": string[]
  },
  "candidate_recipe_set": {
    "candidate_id": string,
    "revision": number,
    "active_component_id": string,
    "components": [
      {
        "component_id": string,
        "role": "main"|"side"|"appetizer"|"dessert"|"drink",
        "title": string,
        "recipe": { /* full canonical recipe */ }
      }
    ]
  },
  "response_context": {
    "mode": "generation",
    "preference_updates": object
  }
}

Rules:
- Max 3 components.
- Each component recipe must be complete and cookable.
- Output JSON only.$$,
    '{"contract":"chat_generation_v1","strict_json":true}'::jsonb,
    true
  ),
  (
    'chat_iteration',
    1,
    'alchemy_chat_iteration_v1',
    $$You are Alchemy. Update existing candidate recipe tabs according to the latest user tweak request.

Return ONLY strict JSON:
{
  "assistant_reply": {
    "text": string,
    "tone": string,
    "emoji": string[],
    "suggested_next_actions": string[]
  },
  "candidate_recipe_set": {
    "candidate_id": string,
    "revision": number,
    "active_component_id": string,
    "components": [
      {
        "component_id": string,
        "role": "main"|"side"|"appetizer"|"dessert"|"drink",
        "title": string,
        "recipe": { /* full canonical recipe */ }
      }
    ]
  },
  "response_context": {
    "mode": "iteration",
    "changed_sections": string[],
    "preference_updates": object
  }
}

Rules:
- Return the full updated candidate set, not a patch.
- Keep max 3 components.
- Preserve coherence across ingredients and steps.
- Output JSON only.$$,
    '{"contract":"chat_iteration_v1","strict_json":true}'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    template = excluded.template,
    metadata = excluded.metadata,
    is_active = excluded.is_active;

insert into public.llm_rules(scope, version, name, rule, is_active)
values
  (
    'chat_ideation',
    1,
    'alchemy_chat_ideation_rule_v1',
    '{
      "response_contract": "chat_ideation_v1",
      "strict_json_only": true,
      "max_questions_per_turn": 1,
      "emit_preference_updates": true
    }'::jsonb,
    true
  ),
  (
    'chat_generation',
    1,
    'alchemy_chat_generation_rule_v1',
    '{
      "response_contract": "chat_generation_v1",
      "strict_json_only": true,
      "max_components": 3,
      "require_complete_recipes": true
    }'::jsonb,
    true
  ),
  (
    'chat_iteration',
    1,
    'alchemy_chat_iteration_rule_v1',
    '{
      "response_contract": "chat_iteration_v1",
      "strict_json_only": true,
      "max_components": 3,
      "return_full_candidate_set": true
    }'::jsonb,
    true
  )
on conflict (scope, version) do update
set name = excluded.name,
    rule = excluded.rule,
    is_active = excluded.is_active;
