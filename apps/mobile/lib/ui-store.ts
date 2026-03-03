import { create } from "zustand";

type UiState = {
  measurementMode: "us" | "metric";
  ingredientGrouping: "category" | "stage";
  inlineMeasurements: boolean;
  stepLayout: "compact" | "detailed";
  generateChatMinimized: boolean;
  setMeasurementMode: (mode: "us" | "metric") => void;
  setIngredientGrouping: (mode: "category" | "stage") => void;
  setInlineMeasurements: (value: boolean) => void;
  setStepLayout: (value: "compact" | "detailed") => void;
  setGenerateChatMinimized: (value: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  measurementMode: "us",
  ingredientGrouping: "category",
  inlineMeasurements: true,
  stepLayout: "detailed",
  generateChatMinimized: false,
  setMeasurementMode: (measurementMode) => set({ measurementMode }),
  setIngredientGrouping: (ingredientGrouping) => set({ ingredientGrouping }),
  setInlineMeasurements: (inlineMeasurements) => set({ inlineMeasurements }),
  setStepLayout: (stepLayout) => set({ stepLayout }),
  setGenerateChatMinimized: (generateChatMinimized) => set({ generateChatMinimized })
}));
