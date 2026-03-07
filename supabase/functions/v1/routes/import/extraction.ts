import { executeVisionScope } from "../../../_shared/llm-executor.ts";
import type { VisionInputImage } from "../../../_shared/llm-executor.ts";
import type { ImportedRecipeDocument } from "../../../_shared/types.ts";
import type { RouteContext } from "../shared.ts";

/**
 * Extracts recipe data from a cookbook-page photo using the
 * recipe_import_vision_extract LLM scope.
 *
 * The photo_asset_ref should be a storage URL from the import-source-photos
 * bucket. The app uploads the photo before calling the import API.
 */
export async function extractFromPhoto(
  serviceClient: RouteContext["serviceClient"],
  photoAssetRef: string,
): Promise<ImportedRecipeDocument> {
  // Resolve the photo URL. If the ref is already a full URL, use it directly.
  // Otherwise, build a Supabase Storage URL.
  let imageUrl = photoAssetRef;
  if (!imageUrl.startsWith("http")) {
    const { data: urlData } = serviceClient.storage
      .from("import-source-photos")
      .getPublicUrl(photoAssetRef);
    imageUrl = urlData.publicUrl;
  }

  const images: VisionInputImage[] = [
    { label: "cookbook_page", imageUrl },
  ];

  const result = await executeVisionScope<ImportedRecipeDocument>({
    client: serviceClient,
    scope: "recipe_import_vision_extract",
    userInput: {
      instruction:
        "Extract the recipe from this cookbook page or handwritten recipe image. Return a structured JSON document with title, ingredients (as an array of strings), instructions (as an array of strings), yields, prepTime, cookTime, and any other visible recipe information.",
    },
    images,
  });

  const doc = result.result;

  return {
    ...doc,
    ingredients: doc.ingredients ?? [],
    instructions: doc.instructions ?? [],
    confidence: doc.confidence ?? 0.7,
    missingFields: doc.missingFields ?? [],
    extractionStrategy: "vision",
  };
}
