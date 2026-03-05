-- Seed Gemini models in llm_model_registry (2026-03).
-- Safe to re-run: uses on conflict do update.

insert into public.llm_model_registry
  (provider, model, display_name, input_cost_per_1m_tokens, output_cost_per_1m_tokens, context_window_tokens, max_output_tokens, notes)
values
  ('google', 'gemini-2.5-flash',       'Gemini 2.5 Flash',       0.30,  2.50, 1048576, 65536, 'Stable Gemini 2.5 Flash model'),
  ('google', 'gemini-2.5-flash-lite',  'Gemini 2.5 Flash-Lite',  0.10,  0.40, 1048576, 65536, 'Stable Gemini 2.5 Flash-Lite model'),
  ('google', 'gemini-2.5-pro',         'Gemini 2.5 Pro',         1.25, 10.00, 1048576, 65536, 'Stable Gemini 2.5 Pro model'),
  ('google', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 0.30, 30.00,   65536, 32768, 'Gemini 2.5 Flash image model (image output is billed per image; output token rate shown for reference)')
on conflict (provider, model) do update
  set display_name              = excluded.display_name,
      input_cost_per_1m_tokens  = excluded.input_cost_per_1m_tokens,
      output_cost_per_1m_tokens = excluded.output_cost_per_1m_tokens,
      context_window_tokens     = excluded.context_window_tokens,
      max_output_tokens         = excluded.max_output_tokens,
      notes                     = excluded.notes,
      updated_at                = now();
