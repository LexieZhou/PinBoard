import type { ExtractedLocation } from "./types";

const TRITON_BASE = "https://tritonai-api.ucsd.edu/v1";
const MODEL = "api-gpt-oss-120b";

const SYSTEM_PROMPT = `You extract specific named geographic places from travel content.
Return JSON ONLY in this exact shape: {"places": [{"name": string, "context": string}]}.

Rules:
- Include only SPECIFIC named places: restaurants, shops, hotels, landmarks, parks, neighborhoods, museums, beaches, viewpoints.
- EXCLUDE generic terms ("the park", "downtown", "the airport") unless they appear as proper nouns ("Central Park").
- EXCLUDE cities/countries used only as broad context ("trip to Japan") — but DO include them if they are the subject of a recommendation
- "context" is a short snippet (<=120 chars) from the source text that mentions or describes the place.
- If there are no specific places, return {"places": []}.
- Do NOT invent places that aren't in the text.`;

type TritonResponse = {
  choices: Array<{ message: { content: string } }>;
};

export async function extractLocations(
  pageText: string,
  pageTitle: string,
  apiKey: string,
): Promise<ExtractedLocation[]> {
  if (!apiKey) throw new Error("Missing VITE_TRITON_API_KEY");

  const trimmed = pageText.slice(0, 12000);
  const userPrompt = `Page title: ${pageTitle}\n\nPage content:\n${trimmed}`;

  const resp = await fetch(`${TRITON_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`TritonAI ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as TritonResponse;
  const raw = data.choices?.[0]?.message?.content ?? "";
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

  const seen = new Set<string>();
  const out: ExtractedLocation[] = [];
  for (const p of places) {
    const name = typeof (p as { name?: unknown }).name === "string" ? (p as { name: string }).name.trim() : "";
    const context =
      typeof (p as { context?: unknown }).context === "string" ? (p as { context: string }).context.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, contextSnippet: context });
  }
  return out;
}

function stripCodeFence(s: string): string {
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : s;
}
