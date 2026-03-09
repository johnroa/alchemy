# iOS Notes

## Cookbook Contract

The cookbook is now private-first and cookbook-entry-first.

Read [private-first-cookbook.md](/Users/john/Projects/alchemy/apps/ios/private-first-cookbook.md) before changing:

- `CookbookView`
- `RecipeDetailView`
- `GenerateView` commit handling
- cookbook networking models in `Core/Networking/APIModels.swift`

That document is the Swift-facing source of truth for:

- which identifier to use on each screen
- which endpoint to call for cookbook vs canonical detail
- how commit responses should be interpreted
- how to decode cookbook list items correctly
