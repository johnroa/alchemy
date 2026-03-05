-- Stabilize chat/generate JSON contract reliability by pinning active core routes
-- to OpenAI structured-output-capable models.

update public.llm_model_routes
set provider = 'openai',
    model = case
      when scope = 'classify' then 'gpt-4.1-mini'
      else 'gpt-4.1'
    end,
    config = (
      coalesce(config, '{}'::jsonb)
      || jsonb_build_object(
        'temperature', case when scope = 'classify' then 0.0 else 0.25 end,
        'timeout_ms', 60000,
        'max_output_tokens', 8192
      )
      - 'token_budget'
      - 'ingredient_budget'
      - 'max_ingredients'
      - 'max_steps'
    )
where scope in ('classify', 'chat_ideation', 'chat_generation', 'chat_iteration', 'generate')
  and is_active = true;
