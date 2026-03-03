# v1 API Function

Edge function implementing `/v1/*` routes.

## Implemented routes

- `POST /v1/recipes/generate`
- `POST /v1/recipes/{id}/tweak`
- `GET /v1/recipes/{id}`
- `POST /v1/recipes/{id}/save`
- `DELETE /v1/recipes/{id}/save`
- `GET /v1/collections`
- `POST /v1/collections`
- `POST /v1/collections/{id}/items`
- `PATCH /v1/preferences`
- `GET /v1/preferences`
- `GET /v1/onboarding/state`
- `POST /v1/onboarding/chat`
- `POST /v1/recipe-drafts`
- `POST /v1/recipe-drafts/{id}/messages`
- `GET /v1/recipe-drafts/{id}`
- `POST /v1/recipe-drafts/{id}/finalize`
- `POST /v1/recipes/{id}/categories/override`
- `DELETE /v1/recipes/{id}/categories/override/{category}`
- `GET /v1/recipes/{id}/graph`
- `GET /v1/recipes/{id}/history`
- `GET /v1/recipes/cookbook`
- `POST /v1/recipes/{id}/attachments`
- `PATCH /v1/recipes/{id}/attachments/{attachment_id}`
- `DELETE /v1/recipes/{id}/attachments/{attachment_id}`
- `GET /v1/changelog`
- `GET /v1/memories`
- `POST /v1/memories/forget`
- `POST /v1/memories/reset`
- `POST /v1/image-jobs/process`

## Adaptive LLM controls

- Active provider/model route is read from `llm_model_routes`.
- Prompt instructions are read from `llm_prompts`.
- Policy rules are read from `llm_rules`.
- Recipe imagery generation also uses active `scope = image` provider/model/prompt/rule records.
- Onboarding interview behavior uses active `scope = onboarding` provider/model/prompt/rule records.
- Memory extraction/selection/summarization/conflict scopes are configured via:
  - `memory_extract`
  - `memory_select`
  - `memory_summarize`
  - `memory_conflict_resolve`

No route-level behavior should depend on hardcoded instruction logic.
