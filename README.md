# PinBoard Clipper

A Chrome extension that extracts named locations from any travel post and drops them as pins on a personal map.

See [`Proposal.md`](./Proposal.md) for the full pitch and roadmap.

## How it works

1. You're reading a travel post (Reddit, blog, listicle).
2. Click the PinBoard Clipper toolbar icon to open the side panel (it docks to the side of the browser, doesn't cover the page). Pick (or create) the list you want to save into — the active list is highlighted in the pill row at the top.
3. **Scan this page for locations**. The extension reads the page text, asks TritonAI to extract specific named places (with city/region context for accurate geocoding), geocodes each one via Google Places API, and drops them as category-tagged pins on a Leaflet map inside the side panel. New pins are tagged with the active list.
4. Switch lists at any time to view a different collection on the map. A pin can belong to multiple lists (re-pinning into a different list just adds the tag), and the map always shows the active list only.
5. **Export** the active list as a `.kml` file for import into Google Maps or other tools.
6. Pins persist across browser sessions in `chrome.storage.local`. The side panel stays open while you browse from post to post.

## Tech stack

- **Chrome Extension (Manifest V3)** — side panel UI (requires Chrome 114+), service worker, on-demand content script injection
- **Vite + React + TypeScript** — bundled via [`@crxjs/vite-plugin`](https://crxjs.dev/vite-plugin)
- **Tailwind CSS v4** — side panel styling
- **TritonAI** (UCSD-hosted, OpenAI-compatible) — location extraction via `api-gpt-oss-120b`
- **Google Places API (New)** — `places:searchText` for geocoding
- **Leaflet + OpenStreetMap tiles** — map rendering inside the side panel

> **Note on the map choice:** the proposal listed the Google Maps JS SDK, but MV3's content security policy forbids remote scripts in extension pages, so loading `maps.googleapis.com/maps/api/js` is blocked. The fix is Leaflet with OSM tiles (bundled package, image tiles only — no remote JS). Geocoding still uses Google Places.

> **Note on side panel vs. popup:** the UI runs as a Chrome side panel rather than a toolbar popup so it doesn't cover the page you're reading. The HTML / React entry point is still `src/popup/popup.html` (directory name kept from earlier iterations); the manifest just points `side_panel.default_path` at it.

## Setup

Requires Node 18+.

```bash
npm install
cp .env.example .env
# then edit .env and fill in your TritonAI and Google Places API keys
npm run build
```

`npm run build` emits a loadable extension into `dist/`.

### Loading in Chrome

1. Open `chrome://extensions/`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Pin the extension to the toolbar
5. Click the icon — the side panel opens on the right. Click again to close.

Re-run `npm run build` after any source change, then hit the refresh icon on the extension card in `chrome://extensions/`.

For iterative work, `npm run dev` enables HMR (you still need to load `dist/` once and refresh after manifest changes).

## Project layout

```
src/
  background/service-worker.ts   orchestrates: inject reader → extract → geocode → save
  lib/
    types.ts                     Pin, ExtractedLocation, message types
    triton.ts                    TritonAI chat-completions client (JSON-mode prompt)
    places.ts                    Google Places (New) searchText client
    pin-store.ts                 chrome.storage.local for pins + lists + active list (dedup by placeId, lists are tags)
  popup/
    popup.html, main.tsx         entry
    App.tsx                      state machine: idle → scanning → preview → pinning → done
    ListBar.tsx                  pill row of lists + create/rename/delete
    MapView.tsx                  react-leaflet map with fit-bounds
  styles/globals.css             Tailwind v4 + Leaflet CSS
manifest.json                    MV3 manifest (read by @crxjs/vite-plugin)
vite.config.ts                   Vite + React + Tailwind + crxjs
```

## Data flow

```
[popup] ── SCAN_ACTIVE_TAB ──▶ [service worker]
                                  │
                                  ├─ chrome.scripting.executeScript({func}) → {url, title, text}
                                  └─ TritonAI /chat/completions → ExtractedLocation[]
[popup] ◀── ScanResponse ──────── [service worker]

[popup] ── GEOCODE_AND_PIN ──▶ [service worker]
                                  │
                                  ├─ Google Places searchText (per location)
                                  └─ pin-store.addPins (dedup by placeId) → Pin[]
[popup] ◀── PinResponse ───────── [service worker]
[popup] re-renders map with all pins, fits bounds
```

## Roadmap

See [`Proposal.md`](./Proposal.md#after-first-deliverable-goals) for full list. Highlights:

- "Clip Pin" from selected text (single-pin shortcut)
- Screenshot-based extraction for image-heavy posts
- ~~Pin collections (Food, Attractions, Nightlife)~~ — shipped
- ~~City/region context for accurate geocoding~~ — shipped
- ~~Export active list as `.kml`~~ — shipped
- Source preview on pin click
- Export pins to a Google Maps list

## Notes on keys & security

Vite inlines `import.meta.env.VITE_*` at build time, so your keys end up in the bundled JS shipped to `dist/`. That's acceptable for a coursework extension you load unpacked. **Don't publish this build** — the keys would be extractable. For a public release, swap to a user-supplied-keys options page or a small backend proxy.
