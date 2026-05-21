import type { PlaceCategory } from "./types";

export const CATEGORY_CONFIG: Record<PlaceCategory, { emoji: string; bg: string; label: string }> = {
  food:       { emoji: "🍽", bg: "#c7936d", label: "food" },
  hotel:      { emoji: "🏨", bg: "#7880c2", label: "hotel" },
  attraction: { emoji: "🎯", bg: "#78a8c2", label: "attraction" },
  other:      { emoji: "📍", bg: "#98c278", label: "other" },
};
