update public.llm_model_routes
set
  model = 'gpt-5'
where
  provider = 'openai'
  and is_active = true
  and scope in ('generate', 'tweak');
