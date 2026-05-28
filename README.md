# PinBoard Clipper

A Chrome extension that extracts named locations from any travel post, text, screenshots, or YouTube videos, drops them as pins on a personal map, and can auto-save the list into Google Maps.

See [`Proposal.md`](./Proposal.md) for the full pitch and roadmap.

## How it works

Click the toolbar icon to open the side panel (it docks to the side, doesn't cover the page). Pick or create a list at the top — new pins are tagged with the active list.

Four ways to add pins:

1. **✏️ Scan page (text)** — reads the article DOM, asks TritonAI to extract specific named places
2. **📸 Scan visible area (vision)** — screenshots the viewport and runs a multimodal LLM over it. Useful for image-heavy posts (RedNote, Instagram screenshots, photo grids).
3. **🎬 Scan YouTube subtitles** — on a `/watch` or `/shorts` page, pulls the description + auto-captions and extracts every place mentioned.
4. **📍 Clip Pin** — select any text on a page and a floating "Add to PinBoard" button appears; one click saves it as a pin in the active list.

Once you have pins:

- **→ Google Maps** — opens Google Maps in a new tab and saves the list with pins.
- **export .kml** — downloads the active list as a `.kml` file for Google My Maps or other tools.
- **clear list** — empties the active list.

## Tech stack

- **Chrome Extension (Manifest V3)** — side panel UI (Chrome 114+), service worker, on-demand `chrome.scripting` injection
- **Vite + React + TypeScript** — bundled via [`@crxjs/vite-plugin`](https://crxjs.dev/vite-plugin)
- **Tailwind CSS v4** — side panel styling
- **TritonAI** (UCSD-hosted, OpenAI-compatible) — text extraction via `api-gpt-oss-120b`, vision extraction via a Claude Sonnet-4.6 model
- **Google Places API (New)** — `places:searchText` for geocoding
- **Leaflet + OpenStreetMap tiles** — map inside the side panel
- **Google Maps web UI automation** — `chrome.scripting.executeScript` drives the real Maps page to create lists and add places

## Setup

Requires Node 18+ and Chrome 114+.

```bash
npm install
cp .env.example .env
# edit .env: VITE_TRITON_API_KEY, VITE_GOOGLE_MAPS_API_KEY
npm run build
```

Load in Chrome: `chrome://extensions/` → enable **Developer mode** → **Load unpacked** → select `dist/`. Pin the extension and click the icon to open the side panel.

## Project layout

```
src/
  background/service-worker.ts   message router: scan (text/vision/youtube) → geocode → pin; clip-pin; gmaps automation
  content/content-script.ts      floating "Add to PinBoard" button on text selection (Shadow DOM)
  lib/
    types.ts                     Pin, ExtractedLocation, message types
    triton.ts                    TritonAI chat-completions client (text + vision, JSON mode)
    places.ts                    Google Places (New) searchText client
    pin-store.ts                 chrome.storage.local: pins + lists + active list (dedup by placeId, lists are tags)
    youtube.ts                   YouTube watch-page detection + description/captions fetch
    gmaps-automation.ts          in-page functions injected into google.com/maps to create lists and add places
    categories.ts                food / hotel / attraction / other styling
  popup/
    popup.html, main.tsx         entry
    App.tsx                      state machine: idle → scanning → preview → pinning → done | sending → sentResult
    ListBar.tsx                  pill row of lists + create/rename/delete
    MapView.tsx                  react-leaflet map with fit-bounds
  styles/globals.css             Tailwind v4 + Leaflet CSS
manifest.json                    MV3 manifest (read by @crxjs/vite-plugin)
```


## Eval

```bash
# Text — gpt-oss-120b (prod) vs claude-sonnet-4-6 (reference)
npx tsx --env-file=.env eval/run-text-scan.ts

# Vision — claude-sonnet-4-6 (prod) vs nova-premier (reference)
npx tsx --env-file=.env eval/run-vision-scan.ts
```

Both scripts print side-by-side outputs + auto P/R/F1 and save raw JSON next to each input. Pass paths as args to run a subset.

Results after manual reconciliation:

| Path | Samples | P | R | F1 |
|---|---|---|---|---|
| Text | 3 Reddit travel posts | 0.99 | 0.91 | 0.95 |
| Vision | 3 map screenshots | 1.00 | 1.00 | 1.00 |

## Demo Video

[YouTube]()

## Transcripts
See the [transcripts](transcripts/) folder for exported chat logs from Claude Code used during development.