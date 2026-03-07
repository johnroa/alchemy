/**
 * Image pipeline public API facade.
 *
 * Re-exports every public function from the image-pipeline sub-modules
 * so consumers can import from a single path. The original
 * recipe-image-pipeline.ts delegates here to preserve backward compatibility.
 *
 * Module layout:
 *   types.ts      — types, constants, normalizers, data access (foundation)
 *   generation.ts — image storage, asset CRUD, reuse eval, resolution
 *   queue.ts      — job enqueue, claim, retry, processImageJobs orchestrator
 *   hydration.ts  — candidate hydration, enrollment, recipe-version attachment
 */

export { enqueueImageRequestJob, processImageJobs } from "./queue.ts";

export {
  attachCommittedCandidateImages,
  attachRecipeVersionToImageRequest,
  enrollCandidateImageRequests,
  ensurePersistedRecipeImageRequest,
  hydrateCandidateRecipeSetImages,
} from "./hydration.ts";
