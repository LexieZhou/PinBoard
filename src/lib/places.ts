import type { ExtractedLocation, GeocodedLocation } from "./types";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

type PlacesResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
};

export async function geocodeOne(
  query: string,
  apiKey: string,
): Promise<Omit<GeocodedLocation, "name" | "contextSnippet" | "category"> | null> {
  if (!apiKey) throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY");

  const resp = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Places ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as PlacesResponse;
  const first = data.places?.[0];
  if (!first?.id || !first.location?.latitude || !first.location?.longitude) return null;

  return {
    placeId: first.id,
    address: first.formattedAddress ?? "",
    lat: first.location.latitude,
    lng: first.location.longitude,
  };
}

export async function geocodeMany(
  locations: ExtractedLocation[],
  apiKey: string,
  cityHint?: string,
): Promise<GeocodedLocation[]> {
  const out: GeocodedLocation[] = [];
  for (const loc of locations) {
    const geo = loc.region || cityHint;
    const query = geo ? `${loc.name}, ${geo}` : loc.name;
    try {
      const g = await geocodeOne(query, apiKey);
      if (g) out.push({ ...loc, ...g });
    } catch (err) {
      console.warn(`geocode failed for ${loc.name}:`, err);
    }
  }
  return out;
}
