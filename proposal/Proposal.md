# PinBoard Clipper

## Title
PinBoard Clipper

## One-Sentence Description
A Chrome extension that extracts locations from any travel post and drops them as pins on a personal map.

## Past Project Reference
Built on top of the prior PinBoard A3 implementation: https://github.com/ucsd-cse-genai-programming-sp26/03-agents-zhzhou-a3

[Stub repo for this project](https://github.com/ucsd-cse-genai-programming-sp26/04-student-choice-zhzhou-a4)

## Planned Technologies
- Chrome Extension (Manifest V3)
- `chrome.storage.local` for persistent on-device data
- TritonAI for location extraction
- Google Maps JS SDK + Places API for geocoding and map rendering
- Tailwind CSS for styling

## First Deliverable
**User story:** A user is reading a Reddit post titled "10 must-visit spots in NYC" on r/travel. They click the PinBoard Clipper extension icon. The extension reads the page text, and within a few seconds the popup shows a preview list: *"Found 8 locations — Joe's Pizza, Smorgasburg, The High Line…"* The user clicks **"Pin All"**. The popup map updates immediately. All 8 pins are dropped on a NYC map, each labeled with the place name and a link back to the source Reddit post. The pins persist across browser sessions.

This workflow forces the system to exercise every major component: DOM extraction, LLM call, Places API call, persistent storage, and map rendering.

## Rough Architecture for First Deliverable

**1. `ContentScript`**
- Input: live DOM of the current tab
- Output: cleaned page text + page URL/title
- Effect: sends extracted content to BackgroundWorker

**2. `BackgroundWorker` (service worker)**
- Input: message from ContentScript
- Output: final pin list returned to Popup
- Effect: orchestrates ExtractLocations → GeocodeLocations; holds API keys

**3. `ExtractLocations`**
- Input: cleaned page text
- Output: `[{ name, contextSnippet }]`
- Effect: calls TritonAI API with an NER prompt to identify specific named places

**4. `GeocodeLocations`**
- Input: `[{ name }]` + optional city hint
- Output: `[{ name, lat, lng, placeId, address, contextSnippet }]`
- Effect: calls Google Places Text Search API; drops unresolved entries

**5. `PinStore`**
- Input: pin objects or read request
- Output: stored pins array
- Effect: persists pins to `chrome.storage.local`


### Data shape

```typescript
type Pin = {
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
}
```

## After First Deliverable Goals
- "Clip Pin" for single locations: select any text on a page → "Add to PinBoard" → single pin saved instantly
- Screenshot support — screenshot-based extraction for image-heavy posts where locations appear in photos rather than text
- Pin collections — group pins into categories (Food, Attractions, Nightlife, etc.)
- Duplicate detection — if a place is already pinned, show a warning instead of creating a duplicate
- Source preview on pin — click a pin → see a snippet of the original post that mentioned it
- Export to Google Maps — one-click export of all pins as a shareable Google Maps list