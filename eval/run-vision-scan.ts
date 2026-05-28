// Vision-path eval. Runs ground-truth (us.amazon.nova-premier-v1:0) and
// production (claude-sonnet-4-6) extraction over screenshots, prints
// side-by-side + auto P/R/F1, saves raw JSON next to each image.
//
// Usage (Node 20+):
//   npx tsx --env-file=.env eval/run-vision-scan.ts                          # all eval/screenshots/*.{jpg,png,webp}
//   npx tsx --env-file=.env eval/run-vision-scan.ts eval/screenshots/x.jpg

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { LLMClient } from "../src/lib/llm-client";

const GT_MODEL = "us.amazon.nova-premier-v1:0";
const PROD_MODEL = "claude-sonnet-4-6";

// MUST stay in sync with src/lib/triton.ts SYSTEM_PROMPT.
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

const VISION_USER_PROMPT = (title: string) =>
  `Page title: ${title}\n\n` +
  `Look at this screenshot from a travel-related page and extract specific named places. ` +
  `For "context", use OCR'd captions/text visible in the image if any; otherwise a short visual description ` +
  `(e.g. "red torii gate by the sea"). All other rules in the system prompt still apply.`;

type Place = { name: string; context?: string; region?: string; category?: string };

function parsePlaces(raw: string): Place[] {
  const stripped = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { json = JSON.parse(m[0]); } catch { return []; }
  }
  const list = (json as { places?: unknown })?.places;
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && typeof (p as Place).name === "string") as Place[];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function mimeFor(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  return "image/jpeg";
}

function toDataUrl(file: string): string {
  const buf = readFileSync(file);
  const b64 = buf.toString("base64");
  return `data:${mimeFor(extname(file))};base64,${b64}`;
}

async function extractFromImage(client: LLMClient, model: string, title: string, dataUrl: string): Promise<Place[]> {
  const resp = await client.chat({
    model,
    temperature: 0.1,
    maxTokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: VISION_USER_PROMPT(title) },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return parsePlaces(resp);
}

function compare(gt: Place[], actual: Place[]) {
  const gtSet = new Set(gt.map((p) => normalize(p.name)));
  const actualSet = new Set(actual.map((p) => normalize(p.name)));
  const tp = [...actualSet].filter((n) => gtSet.has(n));
  const fp = [...actualSet].filter((n) => !gtSet.has(n));
  const fn = [...gtSet].filter((n) => !actualSet.has(n));
  const p = actualSet.size ? tp.length / actualSet.size : 0;
  const r = gtSet.size ? tp.length / gtSet.size : 0;
  const f1 = p + r ? (2 * p * r) / (p + r) : 0;
  return { tp, fp, fn, p, r, f1 };
}

function fmt(places: Place[]): string {
  if (!places.length) return "  (none)";
  return places
    .map((p) => `  - ${p.name}${p.category ? ` (${p.category})` : ""}${p.region ? ` [${p.region}]` : ""}`)
    .join("\n");
}

type Row = { file: string; gtN: number; actN: number; tp: number; fp: number; fn: number; p: number; r: number; f1: number };

async function runFile(client: LLMClient, file: string): Promise<Row> {
  const title = basename(file).replace(/\.[^.]+$/, "");
  const dataUrl = toDataUrl(file);

  console.log(`\n=== ${file} ===`);
  const [gtRes, actRes] = await Promise.allSettled([
    extractFromImage(client, GT_MODEL, title, dataUrl),
    extractFromImage(client, PROD_MODEL, title, dataUrl),
  ]);
  const gt = gtRes.status === "fulfilled" ? gtRes.value : [];
  const actual = actRes.status === "fulfilled" ? actRes.value : [];
  if (gtRes.status === "rejected") console.error(`  GT (${GT_MODEL}) failed: ${gtRes.reason}`);
  if (actRes.status === "rejected") console.error(`  PROD (${PROD_MODEL}) failed: ${actRes.reason}`);

  console.log(`\nGROUND TRUTH (${GT_MODEL}): ${gt.length}`);
  console.log(fmt(gt));
  console.log(`\nEXTRACTED (${PROD_MODEL}): ${actual.length}`);
  console.log(fmt(actual));

  const m = compare(gt, actual);
  console.log(`\nMatch (normalized exact):`);
  console.log(`  TP: ${m.tp.length}  FP: ${m.fp.length}  FN: ${m.fn.length}`);
  console.log(`  Precision: ${m.p.toFixed(3)}  Recall: ${m.r.toFixed(3)}  F1: ${m.f1.toFixed(3)}`);
  if (m.fp.length) console.log(`  FP: ${m.fp.join(", ")}`);
  if (m.fn.length) console.log(`  FN: ${m.fn.join(", ")}`);

  const base = file.replace(/\.[^.]+$/, "");
  writeFileSync(`${base}.gt.json`, JSON.stringify(gt, null, 2) + "\n");
  writeFileSync(`${base}.actual.json`, JSON.stringify(actual, null, 2) + "\n");

  return { file: basename(file), gtN: gt.length, actN: actual.length, tp: m.tp.length, fp: m.fp.length, fn: m.fn.length, p: m.p, r: m.r, f1: m.f1 };
}

async function main() {
  const apiKey = process.env.VITE_TRITON_API_KEY ?? process.env.TRITON_API_KEY;
  if (!apiKey) {
    console.error("set VITE_TRITON_API_KEY in .env (or pass --env-file=.env)");
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((a) => resolve(a))
    : readdirSync(resolve("eval/screenshots"))
        .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
        .sort()
        .map((f) => join(resolve("eval/screenshots"), f));

  if (!files.length) {
    console.error("no image files found in eval/screenshots/");
    process.exit(2);
  }

  const client = new LLMClient(apiKey);
  const rows: Row[] = [];
  for (const f of files) rows.push(await runFile(client, f));

  console.log(`\n=== Summary (paste into EVAL.md) ===\n`);
  console.log(`| # | File | GT | Extracted | TP | FP | FN | P | R | F1 |`);
  console.log(`|---|---|----|-----------|----|----|----|---|---|----|`);
  rows.forEach((r, i) => {
    console.log(`| ${i + 1} | ${r.file} | ${r.gtN} | ${r.actN} | ${r.tp} | ${r.fp} | ${r.fn} | ${r.p.toFixed(2)} | ${r.r.toFixed(2)} | ${r.f1.toFixed(2)} |`);
  });

  const agg = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  const P = agg.tp + agg.fp ? agg.tp / (agg.tp + agg.fp) : 0;
  const R = agg.tp + agg.fn ? agg.tp / (agg.tp + agg.fn) : 0;
  const F1 = P + R ? (2 * P * R) / (P + R) : 0;
  console.log(`\n**Aggregate (micro):** P = ${P.toFixed(3)} · R = ${R.toFixed(3)} · F1 = ${F1.toFixed(3)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
