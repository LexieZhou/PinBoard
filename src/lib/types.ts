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
  | { type: "SCAN_VISIBLE_AREA" }
  | {
      type: "GEOCODE_AND_PIN";
      locations: ExtractedLocation[];
      pageContent: PageContent;
      targetListId: string;
    }
  | { type: "SEND_TO_GMAPS"; pins: Pin[]; listName: string }
  | {
      type: "CLIP_PIN";
      selectedText: string;
      pageUrl: string;
      pageTitle: string;
    };

export type ScanResponse =
  | { ok: true; result: ScanResult }
  | { ok: false; error: string };

export type PinResponse =
  | { ok: true; pins: Pin[] }
  | { ok: false; error: string };

export type ClipPinResponse =
  | { ok: true; addedCount: number; firstName: string; listName: string }
  | { ok: false; error: string };

export type GmapsFailure = { name: string; reason: string };

export type GmapsSendResponse =
  | { ok: true; saved: number; failed: GmapsFailure[] }
  | { ok: false; error: string };

/** One-way progress ping from the service worker to the side panel during a send. */
export type GmapsProgressMessage = {
  type: "GMAPS_PROGRESS";
  done: number;
  total: number;
  name: string;
};
