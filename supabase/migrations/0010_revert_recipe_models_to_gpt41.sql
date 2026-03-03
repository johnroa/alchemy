-- Revert generate/tweak scopes from gpt-5 (reasoning model) back to gpt-4.1.
-- gpt-5 takes 30–60 s for structured output, causing llm_provider_timeout on every
-- synchronous recipe generation call. gpt-4.1 handles the full recipe JSON contract
-- in 3–8 s and is the correct model for user-facing generation.
update public.llm_model_routes
set model = 'gpt-4.1'
where scope = 'generate'
  and provider = 'openai'
  and is_active = true;

update public.llm_model_routes
set model = 'gpt-4.1-mini'
where scope = 'tweak'
  and provider = 'openai'
  and is_active = true;
