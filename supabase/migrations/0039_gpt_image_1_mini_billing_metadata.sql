insert into public.llm_model_registry (
  provider,
  model,
  display_name,
  input_cost_per_1m_tokens,
  output_cost_per_1m_tokens,
  billing_mode,
  billing_metadata,
  context_window_tokens,
  max_output_tokens,
  is_available,
  notes
)
values (
  'openai',
  'gpt-image-1-mini',
  'GPT Image 1 Mini',
  2.50,
  8.00,
  'image',
  jsonb_build_object(
    'pricing_type', 'openai_image_quality_size',
    'default_quality', 'high',
    'default_size', '1536x1024',
    'image_rates_usd', jsonb_build_object(
      'low', jsonb_build_object(
        '1024x1024', 0.005,
        '1536x1024', 0.006,
        '1024x1536', 0.006
      ),
      'medium', jsonb_build_object(
        '1024x1024', 0.011,
        '1536x1024', 0.015,
        '1024x1536', 0.015
      ),
      'high', jsonb_build_object(
        '1024x1024', 0.036,
        '1536x1024', 0.052,
        '1024x1536', 0.052
      )
    )
  ),
  null,
  null,
  true,
  'Cost-efficient OpenAI image generation model'
)
on conflict (provider, model) do update
set input_cost_per_1m_tokens = excluded.input_cost_per_1m_tokens,
    output_cost_per_1m_tokens = excluded.output_cost_per_1m_tokens,
    billing_mode = excluded.billing_mode,
    billing_metadata = excluded.billing_metadata,
    is_available = excluded.is_available,
    updated_at = now();
