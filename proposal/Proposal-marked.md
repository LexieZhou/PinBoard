# PinBoard Clipper — Marked-up Proposal

> Each item from the original proposal is annotated with one of:
> - **(a) Implemented as written** — implemented
> - **(b) Planned** — planned to be implemented
> - **(c) No longer planned** — no longer planned

## Title
PinBoard Clipper

## One-Sentence Description
A Chrome extension that extracts locations from any travel post and drops them as pins on a personal map.

## Past Project Reference
Built on top of the prior PinBoard A3 implementation: https://github.com/ucsd-cse-genai-programming-sp26/03-agents-zhzhou-a3

[Stub repo for this project](https://github.com/ucsd-cse-genai-programming-sp26/04-student-choice-zhzhou-a4)

## Planned Technologies

| Technology | Status | Notes |
|---|---|---|
| Chrome Extension (Manifest V3) | **(a)** | `manifest.json:2` declares MV3. |
| `chrome.storage.local` for persistent on-device data | **(a)** | `src/lib/pin-store.ts:14` reads/writes `chrome.storage.local`. |
| TritonAI for location extraction | **(a)** | `src/lib/triton.ts` — `extractLocations` (text) and `extractLocationsFromImage` (vision). |
| Google Maps JS SDK + Places API for geocoding and map rendering | **(a)** | Geocoding uses Google **Places API (Text Search)** in `src/lib/places.ts`. |
| Tailwind CSS for styling | **(a)** | - |

## First Deliverable

> *User story: A user is reading a Reddit post titled "10 must-visit spots in NYC"... clicks the PinBoard Clipper extension icon. The extension reads the page text, and within a few seconds the popup shows a preview list... The user clicks "Pin All". The popup map updates immediately. All 8 pins are dropped on a NYC map, each labeled with the place name and a link back to the source Reddit post. The pins persist across browser sessions.*

**(a) Implemented as written** The exact flow lives in `src/popup/App.tsx`:
1. Click icon.
2. "Scan this page for locations" button (`App.tsx`) → fires `SCAN_ACTIVE_TAB` → `handleScan` reads DOM via `chrome.scripting.executeScript` (`service-worker.ts`) and runs TritonAI.
3. Preview list with checkboxes (`App.tsx:434-485`) — each row shows name + context snippet.
4. "Pin N to list" (`App.tsx`) → `GEOCODE_AND_PIN` → `handlePin` (`service-worker.ts`) → Places geocoding → `addPins`.
5. Map updates immediately (`MapView.tsx` re-renders from `visiblePins` memo, `App.tsx`).
6. Persistence across sessions: `chrome.storage.local` (`pin-store.ts`).

## Rough Architecture for First Deliverable

### 1. `ContentScript`
- *Input: live DOM of current tab; Output: cleaned text + URL/title; Effect: sends to BackgroundWorker.*

**(a) Implemented.** The service worker pulls it on demand via `chrome.scripting.executeScript` (`service-worker.ts`).

### 2. `BackgroundWorker` (service worker)
- *Orchestrates ExtractLocations → GeocodeLocations; holds API keys.*

**(a) Implemented.** `src/background/service-worker.ts` is the orchestrator. Message dispatch table at `service-worker.ts:339-365`.

### 3. `ExtractLocations`
- *Input: cleaned page text; Output: `[{ name, contextSnippet }]`; calls TritonAI.*

**(a) Implemented.** `extractLocations` in `src/lib/triton.ts`. Output type `ExtractedLocation` (`types.ts:24-29`) extends the proposal's `{ name, contextSnippet }` with two extra fields the LLM now returns: `region` (for chain-store disambiguation) and `category` (food/hotel/attraction/other).

### 4. `GeocodeLocations`
- *Input: `[{ name }]` + optional city hint; Output: lat/lng/placeId/address/snippet; drops unresolved entries.*

**(a) Implemented.** `geocodeMany` in `src/lib/places.ts`, invoked at `service-worker.ts:121` with the page title as the city hint. Drops unresolved entries.

### 5. `PinStore`
- *Input: pin objects or read request; Output: stored pins array; persists to database.*

**(a) Implemented.** `src/lib/pin-store.ts` is the proposal's PinStore.


## After First Deliverable Goals

| Goal | Status | Where |
|---|---|---|
| **"Clip Pin" for single locations** | **(a)** | Floating button implemented in `src/content/content-script.ts`; server-side handler at `service-worker.ts` (`handleClipPin`). |
| **Screenshot support** — vision-based extraction for image-heavy posts | **(a)** | "Scan visible area (vision)" button in `App.tsx` → `SCAN_VISIBLE_AREA` → `handleVisionScan` (`service-worker.ts`) captures the viewport via `chrome.tabs.captureVisibleTab` and calls `extractLocationsFromImage` for TritonAI Claude Sonnet 4.6 model. |
| **Pin collections** — group pins into categories | **(a)** | Added pin category (`food` / `hotel` / `attraction` / `other`) returned by the LLM, rendered as colored emoji pins on the map and in the list (`src/lib/categories.ts`, `MapView.tsx`, `App.tsx`). |
| **Duplicate detection** — warn instead of duplicating | **(a)** | `addPins` in `pin-store.ts` keys by `placeId`: re-pinning the same place from another source merges `listIds` rather than creating a second pin. |
| **Source preview on pin** — click a pin → see a snippet of the original post | **(a)** | The map currently shows the source link which is clickable. |
| **Export to Google Maps** — one-click export as a shareable Google Maps list | **(a)** | The "→ Google Maps" button (`App.tsx:257-264`) fires `SEND_TO_GMAPS` → `handleSendToGmaps` (`service-worker.ts:184-247`), which opens Google Maps in a new tab and drives the UI via `chrome.scripting.executeScript`. |

### Beyond-proposal additions

- **YouTube subtitles scan** — pull description + auto-captions from a YouTube page and extract locations mentioned (`src/lib/youtube.ts`, `service-worker.ts`).
