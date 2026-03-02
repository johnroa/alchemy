import { create } from "zustand";

type UiState = {
  measurementMode: "us" | "metric";
  setMeasurementMode: (mode: "us" | "metric") => void;
};

export const useUiStore = create<UiState>((set) => ({
  measurementMode: "us",
  setMeasurementMode: (measurementMode) => set({ measurementMode })
}));
