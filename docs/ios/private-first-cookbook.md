# Private-First Cookbook Contract For iOS

This document explains how iOS should think about saved recipes after the
private-first cookbook architecture change.

It is intentionally Swift-oriented. The goal is to make cookbook, detail,
commit, and navigation work without guessing which id or endpoint is correct.

## The Core Model

There are now two different identities in play:

1. `cookbook_entry_id`
   The private saved-recipe identity for one user.

2. `recipe_id`
   The public canonical recipe identity.

They are not interchangeable.

### What each one means

- `cookbook_entry_id` is the thing the current user owns in their cookbook.
- `recipe_id` is the public canonical recipe that Explore and the website use.
- A cookbook entry may exist before `recipe_id` exists.
- A freshly committed recipe can have `canonical_status = "pending"` and
  `recipe_id = null`.

That means Swift must treat the cookbook entry id as the primary identity for
private saved recipes.

## Endpoint Ownership

Use these routes consistently:

### Private cookbook routes

- `GET /recipes/cookbook`
  Returns the cookbook feed for the authenticated user.

- `GET /recipes/cookbook/{entryId}`
  Returns private-first recipe detail for one saved cookbook entry.

- `POST /recipes/cookbook/{entryId}/variant/refresh`
  Refreshes or materializes the private variant for that saved entry.

- `DELETE /recipes/cookbook/{entryId}`
  Removes the cookbook entry.

### Canonical/public routes

- `GET /recipes/{id}`
  Returns canonical public recipe detail.

- `POST /recipes/{id}/save`
  Saves a canonical recipe into the user cookbook and creates or links a
  cookbook entry.

### Compatibility route

- `GET /recipes/{id}/variant`
  Compatibility wrapper only. Do not treat this as the primary cookbook detail
  path going forward.

## Screen Rules

### Cookbook tab

The cookbook tab is entry-first.

- Each cell should be keyed by `cookbookEntryId`.
- Opening a cookbook card should navigate with `cookbookEntryId`.
- Deleting from cookbook should delete by `cookbookEntryId`.
- Stale review and variant refresh should operate on the cookbook entry.

Do not navigate cookbook cards using canonical `recipeId`.

### Recipe detail

Recipe detail now has two valid modes:

1. Public mode
   Construct with canonical `recipeId` and fetch `GET /recipes/{id}`.

2. Cookbook mode
   Construct with `cookbookEntryId` and fetch `GET /recipes/cookbook/{entryId}`.

For cookbook mode, the top-level response contains cookbook-entry metadata plus
the rendered recipe under `recipe`.

### Generate commit flow

After `POST /chat/{id}/commit`, iOS should think:

- the saved thing is a cookbook entry first
- canon may not exist yet
- `cookbookEntryId` is the only guaranteed stable identifier for private opens

The commit response already carries:

- `cookbook_entry_id`
- nullable `recipe_id`
- `canonical_status`
- variant lineage ids

If a future iOS flow wants to deep-link straight into the saved recipe after
commit, it should open cookbook detail with `cookbookEntryId`, not `recipeId`.

### Explore and public surfaces

Explore, web, and any public recipe sharing flow should continue to use
canonical `recipeId`.

Those surfaces should not depend on cookbook entry ids.

## Swift Decoding Rules

## The important trap

`JSONDecoder.KeyDecodingStrategy.convertFromSnakeCase` does not transform
JSON `id` into `cookbookEntryId`.

That is why cookbook loading broke.

The cookbook feed returns items like:

```json
{
  "id": "ddbb9016-12ae-4dc4-9698-3192b9aad5f3",
  "canonical_recipe_id": "d4469189-19d1-4c63-aad4-100597084cc0",
  "recipe_id": "d4469189-19d1-4c63-aad4-100597084cc0",
  "canonical_status": "ready",
  "title": "Spicy Salmon Rice Bowl"
}
```

The Swift model exposes `cookbookEntryId`, so it must map `id` explicitly:

```swift
private enum CodingKeys: String, CodingKey {
    case cookbookEntryId = "id"
    case canonicalRecipeId, recipeId, canonicalStatus
    case title, summary, imageUrl, imageStatus
    case category, visibility, updatedAt, quickStats
    case variantStatus, activeVariantVersionId, personalizedAt
    case autopersonalize, savedAt, variantTags, matchedChipIds
}
```

Without that mapping, the decoder looks for `cookbook_entry_id`, does not find
it, and the entire `CookbookResponse` decode fails.

## Recommended Swift Model Boundaries

Keep these model layers separate:

### Feed row

`CookbookEntryItem`

This is cookbook-entry metadata plus preview content.

Important fields:

- `cookbookEntryId`
- `canonicalRecipeId`
- `recipeId`
- `canonicalStatus`
- `variantStatus`
- `activeVariantVersionId`

### Private detail envelope

`CookbookRecipeDetailResponse`

This is not the same thing as `RecipeDetail`.

It contains:

- cookbook entry metadata
- canonical linkage metadata
- variant lineage metadata
- the rendered recipe payload under `recipe`

### Canonical detail

`RecipeDetail`

This is still the right model for `GET /recipes/{id}`.

## Migration Checklist For Swift

When touching cookbook flows, verify all of these:

1. Feed decode
   `CookbookEntryItem` maps JSON `id` to `cookbookEntryId`.

2. Navigation identity
   Cookbook opens use `cookbookEntryId`.

3. Delete behavior
   Cookbook delete uses `/recipes/cookbook/{entryId}`.

4. Detail fetch
   Cookbook detail uses `/recipes/cookbook/{entryId}`.

5. Variant refresh
   Cookbook-origin tweaks use `/recipes/cookbook/{entryId}/variant/refresh`.

6. Commit handling
   Post-commit flows prefer `cookbookEntryId` over `recipeId`.

7. Public surfaces
   Explore/public detail continues to use canonical `recipeId`.

## Current iOS Status

As of this document:

- `CookbookView` loads `GET /recipes/cookbook`
- `RecipeDetailView(cookbookEntryId:)` correctly uses
  `GET /recipes/cookbook/{entryId}`
- cookbook-origin tweaks correctly use
  `POST /recipes/cookbook/{entryId}/variant/refresh`
- the cookbook decode bug was fixed by mapping JSON `id` to
  `cookbookEntryId`

## Recommended Next Swift Cleanup

The minimum bug fix is done, but the architecture suggests these follow-ups:

### 1. Make commit result first-class in Generate

Right now Generate mostly fire-and-forgets commit and relies on Cookbook to
refresh afterward.

Stronger model:

- decode commit result fully
- keep the first returned `cookbookEntryId`
- optionally route straight to cookbook detail if product wants that behavior

### 2. Stop treating canonical recipe id as the cookbook card identity

Any remaining helper or analytics code that assumes a cookbook card id is a
recipe id should be updated to treat it as a cookbook entry id first.

### 3. Keep entry metadata and recipe-body models separate

Avoid flattening cookbook entry fields directly into `RecipeDetail`.
That separation will matter more while canon is pending or failed.

## Short Rule Of Thumb

If the user is looking at something they personally saved, use
`cookbookEntryId`.

If the user is looking at something public in Explore or on the website, use
`recipeId`.
