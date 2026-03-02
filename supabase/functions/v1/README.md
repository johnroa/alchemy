# v1 API Function

Edge function implementing `/v1/*` routes.

## Implemented routes

- `POST /v1/recipes/generate`
- `POST /v1/recipes/{id}/tweak`
- `GET /v1/recipes/{id}`
- `GET /v1/recipes/feed`
- `POST /v1/recipes/{id}/save`
- `DELETE /v1/recipes/{id}/save`
- `GET /v1/collections`
- `POST /v1/collections`
- `POST /v1/collections/{id}/items`
- `PATCH /v1/preferences`
- `GET /v1/preferences`
- `POST /v1/recipe-drafts`
- `POST /v1/recipe-drafts/{id}/messages`
- `GET /v1/recipe-drafts/{id}`
- `POST /v1/recipe-drafts/{id}/finalize`
- `POST /v1/recipes/{id}/categories/override`
- `DELETE /v1/recipes/{id}/categories/override/{category}`
- `GET /v1/recipes/{id}/graph`

## Adaptive LLM controls

- Active provider/model route is read from `llm_model_routes`.
- Prompt instructions are read from `llm_prompts`.
- Policy rules are read from `llm_rules`.
- Recipe imagery generation also uses active `scope = image` provider/model/prompt/rule records.

No route-level behavior should depend on hardcoded instruction logic.
