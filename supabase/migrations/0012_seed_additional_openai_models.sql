-- Normalize OpenAI model catalog to GPT-5 + GPT-4.1 + GPT Image,
-- and remove o3/4o families from default availability.
-- Safe to re-run.

insert into public.llm_model_registry
  (provider, model, display_name, input_cost_per_1m_tokens, output_cost_per_1m_tokens, context_window_tokens, max_output_tokens, notes)
values
  ('openai', 'gpt-5.1',       'GPT-5.1',       1.25, 10.00,   400000, 128000, 'Current flagship GPT-5 model'),
  ('openai', 'gpt-5',         'GPT-5',         1.25, 10.00,   400000, 128000, 'High-quality GPT-5 model'),
  ('openai', 'gpt-5-mini',    'GPT-5 Mini',    0.25,  2.00,   400000, 128000, 'Fast cost-efficient GPT-5 variant'),
  ('openai', 'gpt-5-nano',    'GPT-5 Nano',    0.05,  0.40,   400000, 128000, 'Lowest-latency GPT-5 variant'),
  ('openai', 'gpt-4.1',       'GPT-4.1',       2.00,  8.00,  1000000,  32768, 'Stable GPT-4.1 fallback'),
  ('openai', 'gpt-4.1-mini',  'GPT-4.1 Mini',  0.40,  1.60,  1000000,  32768, 'Cost-efficient GPT-4.1 variant'),
  ('openai', 'gpt-image-1.5', 'GPT Image 1.5', 5.00, 10.00,      null,   null, 'Latest OpenAI image generation model'),
  ('openai', 'gpt-image-1',   'GPT Image 1',   5.00, 40.00,      null,   null, 'Legacy OpenAI image generation model')
on conflict (provider, model) do update
set
  display_name              = excluded.display_name,
  input_cost_per_1m_tokens  = excluded.input_cost_per_1m_tokens,
  output_cost_per_1m_tokens = excluded.output_cost_per_1m_tokens,
  context_window_tokens     = excluded.context_window_tokens,
  max_output_tokens         = excluded.max_output_tokens,
  notes                     = excluded.notes,
  is_available              = true,
  updated_at                = now();

update public.llm_model_routes
set
  model = case
    when scope = 'generate' then 'gpt-5'
    when scope = 'image' then 'gpt-image-1.5'
    else 'gpt-5-mini'
  end
where provider = 'openai'
  and model in ('gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini');

delete from public.llm_model_registry
where provider = 'openai'
  and model in ('gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini');
