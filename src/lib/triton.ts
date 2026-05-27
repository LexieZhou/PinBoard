import type { ExtractedLocation, PlaceCategory } from "./types";
import { LLMClient } from "./llm-client";

const TEXT_MODEL = "api-gpt-oss-120b";
const VISION_MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You extract specific named geographic places from travel content.
Return JSON ONLY in this exact shape: {"places": [{"name": string, "context": string, "region": string, "category": string}]}.

Rules:
- Include only SPECIFIC named places: restaurants, cafes, shops, hotels, landmarks, parks, museums, beaches, viewpoints.
- EXCLUDE generic terms ("the park", "downtown", "the airport") unless they appear as proper nouns ("Central Park").
- EXCLUDE cities/countries used only as broad context ("trip to Japan") — but DO include them if they are the subject of a recommendation.
- "name" and "region" MUST be in ENGLISH. If the source text is in another language, translate or transliterate to the canonical English name that Google Maps would recognize (e.g. Chinese "故宫" → "Forbidden City"). This applies even when the surrounding page is non-English.
- "context" is a short snippet (<=120 chars) from the source text that mentions or describes the place. Keep "context" in the ORIGINAL source language (do not translate it).
- "region" is the city and country where this specific place is located, inferred from the surrounding text (e.g. "Shibuya, Tokyo, Japan" or "Brooklyn, New York, USA"). Use the most specific geographic scope you can confidently infer. If truly unknown, use "".
- "category" must be exactly one of: "food" (restaurants, cafes, bars, food markets, street food), "hotel" (hotels, hostels, ryokans, guesthouses, resorts), "attraction" (landmarks, museums, parks, beaches, temples, viewpoints, shops), or "other" (anything that doesn't fit).
- If there are no specific places, return {"places": []}.
- Do NOT invent places that aren't in the text.`;

export async function extractLocations(
  pageText: string,
  pageTitle: string,
  apiKey: string,
): Promise<ExtractedLocation[]> {
  const trimmed = pageText.slice(0, 12000);
  const userPrompt = `Page title: ${pageTitle}\n\nPage content:\n${trimmed}`;

  const client = new LLMClient(apiKey);
  const raw = await client.chat({
    model: TEXT_MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  return parsePlacesJson(raw);
}

// Vision-mode extractor: same system prompt, same output schema, so the rest of
// the pipeline (preview → geocode → pin) doesn't need to know whether the
// locations came from text or pixels. Used for image-heavy posts (Xiaohongshu,
// IG screenshots, photo grids) where DOM text yields nothing.
export async function extractLocationsFromImage(
  imageDataUrl: string,
  pageTitle: string,
  apiKey: string,
): Promise<ExtractedLocation[]> {
  const userText =
    `Page title: ${pageTitle}\n\n` +
    `Look at this screenshot from a travel-related page and extract specific named places. ` +
    `For "context", use OCR'd captions/text visible in the image if any; otherwise a short visual description ` +
    `(e.g. "red torii gate by the sea"). All other rules in the system prompt still apply.`;

  const client = new LLMClient(apiKey);
  const raw = await client.chat({
    model: VISION_MODEL,
    temperature: 0.1,
    maxTokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
  return parsePlacesJson(raw);
}

function parsePlacesJson(raw: string): ExtractedLocation[] {
  const jsonText = stripCodeFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const places = (parsed as { places?: unknown })?.places;
  if (!Array.isArray(places)) return [];

  const VALID_CATEGORIES = new Set<PlaceCategory>(["food", "hotel", "attraction", "other"]);

  const seen = new Set<string>();
  const out: ExtractedLocation[] = [];
  for (const p of places) {
    const name = typeof (p as { name?: unknown }).name === "string" ? (p as { name: string }).name.trim() : "";
    const context =
      typeof (p as { context?: unknown }).context === "string" ? (p as { context: string }).context.trim() : "";
    const region =
      typeof (p as { region?: unknown }).region === "string" ? (p as { region: string }).region.trim() : undefined;
    const rawCat = (p as { category?: unknown }).category;
    const category: PlaceCategory =
      typeof rawCat === "string" && VALID_CATEGORIES.has(rawCat as PlaceCategory)
        ? (rawCat as PlaceCategory)
        : "other";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, contextSnippet: context, region: region || undefined, category });
  }
  return out;
}

function stripCodeFence(s: string): string {
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : s;
}
