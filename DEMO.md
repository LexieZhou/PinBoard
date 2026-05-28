# PinBoard Clipper — Demo

A Chrome MV3 extension.

## YouTube demo


## Build from scratch

Requires Node 18+ and Chrome 114+.

1. Clone and install:
   ```bash
   git clone https://github.com/ucsd-cse-genai-programming-sp26/04-student-choice-zhzhou-a4.git
   cd 04-student-choice-zhzhou-a4
   npm install
   ```
2. Add API keys:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `VITE_TRITON_API_KEY` — your TritonAI key
   - `VITE_GOOGLE_MAPS_API_KEY` — a Google Cloud key with **Places API (New)** enabled (see below)
3. Get a Google Cloud key:
   1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create (or pick) a project.
   2. **APIs & Services → Library** → search **Places API (New)** → **Enable**.
   3. **APIs & Services → Credentials** → **Create credentials → API key** → copy the key into `VITE_GOOGLE_MAPS_API_KEY`.
   4. (Recommended) Click the key → **API restrictions** → restrict to **Places API (New)**.
4. Build:
   ```bash
   npm run build
   ```
   This emits a loadable extension into `dist/`.
5. Load it in Chrome: `chrome://extensions/` → Toggle on **Developer mode** → **Load unpacked** → select `dist/`.
