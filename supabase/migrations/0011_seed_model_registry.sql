-- Seed llm_model_registry with OpenAI + Anthropic models and per-token pricing (2026-03).
-- Safe to re-run: uses on conflict do update.

create table if not exists public.llm_model_registry (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  display_name text not null,
  input_cost_per_1m_tokens numeric(10,4) not null default 0,
  output_cost_per_1m_tokens numeric(10,4) not null default 0,
  context_window_tokens int,
  max_output_tokens int,
  is_available boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, model)
);

insert into public.llm_model_registry
  (provider, model, display_name, input_cost_per_1m_tokens, output_cost_per_1m_tokens, context_window_tokens, max_output_tokens, notes)
values
  -- OpenAI
  ('openai', 'gpt-5.1',      'GPT-5.1',        1.25, 10.00,   400000, 128000, 'Current flagship GPT-5 model'),
  ('openai', 'gpt-5',        'GPT-5',          1.25, 10.00,   400000, 128000, 'High-quality GPT-5 model'),
  ('openai', 'gpt-5-mini',   'GPT-5 Mini',     0.25,  2.00,   400000, 128000, 'Fast cost-efficient GPT-5 variant'),
  ('openai', 'gpt-5-nano',   'GPT-5 Nano',     0.05,  0.40,   400000, 128000, 'Lowest-latency GPT-5 variant'),
  ('openai', 'gpt-4.1',      'GPT-4.1',        2.00,  8.00,  1000000, 32768,  'Stable GPT-4.1 fallback'),
  ('openai', 'gpt-4.1-mini', 'GPT-4.1 Mini',   0.40,  1.60,  1000000, 32768,  'Cost-efficient GPT-4.1 variant'),
  ('openai', 'gpt-image-1.5','GPT Image 1.5',  5.00, 10.00,     null,   null, 'Latest OpenAI image generation model'),
  ('openai', 'gpt-image-1',  'GPT Image 1',    5.00, 40.00,     null,   null, 'Legacy OpenAI image generation model'),
  -- Anthropic
  ('anthropic', 'claude-opus-4-6',   'Claude Opus 4.6',   15.00, 75.00, 200000, 32000, 'Most capable Claude model'),
  ('anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6',  3.00, 15.00, 200000, 64000, 'Balanced Claude Sonnet'),
  ('anthropic', 'claude-haiku-4-5',  'Claude Haiku 4.5',   0.80,  4.00, 200000, 16000, 'Fast Claude Haiku')
on conflict (provider, model) do update
  set display_name              = excluded.display_name,
      input_cost_per_1m_tokens  = excluded.input_cost_per_1m_tokens,
      output_cost_per_1m_tokens = excluded.output_cost_per_1m_tokens,
      context_window_tokens     = excluded.context_window_tokens,
      max_output_tokens         = excluded.max_output_tokens,
      notes                     = excluded.notes,
      updated_at                = now();
