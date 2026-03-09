/**
 * Re-export shim for backward compatibility.
 *
 * The llm-gateway module has been split into domain-specific files under
 * _shared/llm-gateway/. This file preserves the original import path so
 * existing consumers don't need to be updated immediately.
 *
 * New code should import directly from the specific module:
 *   import { llmGateway } from "../_shared/llm-gateway/index.ts";
 *   import type { ModelOverrideMap } from "../_shared/llm-gateway/types.ts";
 */
export {
  llmGateway,
  type CanonicalRecipeReviewResult,
  type ModelOverrideMap,
  type SubstitutionDiff,
  type PersonalizeRecipeResult,
} from "./llm-gateway/index.ts";
