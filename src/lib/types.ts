export type PlaceCategory = "food" | "hotel" | "attraction" | "other";

export type List = {
  id: string;
  name: string;
  createdAt: string;
};

export type Pin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  placeId: string;
  address: string;
  sourceUrl: string;
  sourceTitle: string;
  contextSnippet: string;
  savedAt: string;
  listIds: string[];
  category: PlaceCategory;
};

export type ExtractedLocation = {
  name: string;
  contextSnippet: string;
  region?: string;
  category: PlaceCategory;
};

export type PageContent = {
  url: string;
  title: string;
  text: string;
};

export type ScanResult = {
  pageContent: PageContent;
  locations: ExtractedLocation[];
};

export type GeocodedLocation = ExtractedLocation & {
  lat: number;
  lng: number;
  placeId: string;
  address: string;
};

export type RuntimeMessage =
  | { type: "SCAN_ACTIVE_TAB" }
  | {
      type: "GEOCODE_AND_PIN";
      locations: ExtractedLocation[];
      pageContent: PageContent;
      targetListId: string;
    };

export type ScanResponse =
  | { ok: true; result: ScanResult }
  | { ok: false; error: string };

export type PinResponse =
  | { ok: true; pins: Pin[] }
  | { ok: false; error: string };
