# Evaluation

Only the AI-driven parts are evaluated: **extraction** (LLM finds named places) and **geocoding** (Google Places resolves them to lat/lng). The rest is deterministic.

## Metrics

- **Precision** = correct extractions / total extractions
- **Recall** = correct extractions / total ground-truth places
- **Geocoding accuracy** = pins within ~500 m of the intended place / total geocoded

A pin is **correct** if its name matches a ground-truth place (case-/language-insensitive) AND its coordinates are within ~500 m. Hallucinations count as FP; duplicates collapse to one.

## Test set

### Text scan

Pipeline: `claude-sonnet-4-6` drafts a ground-truth list, `api-gpt-oss-120b` (production) runs in parallel, both via `eval/run-text-scan.ts`. Raw outputs in `eval/text/0X.gt.json` and `0X.actual.json`. Auto normalized-exact match was too strict (penalized `Joe's` vs `Joe's Pizza` etc.) and Claude's GT itself missed real places — so the numbers below are after **manual reconciliation against the source text**.

| # | URL | True | Extracted | TP | FP | FN | P | R | F1 |
|---|---|------|-----------|----|----|----|------|------|------|
| 1 | [San Diego itinerary](https://www.reddit.com/r/travel/comments/1mqdxc6/critique_my_san_diego_itinerary/) | 34 | 33 | 33 | 0 | 1 | 1.00 | 0.97 | 0.99 |
| 2 | [NYC itinerary](https://www.reddit.com/r/travel/comments/1jj7jof/amazing_time_in_new_york_my_itinerary_if_it_helps/) | 29 | 26 | 25 | 1 | 4 | 0.96 | 0.86 | 0.91 |
| 3 | [Chiang Mai reflection](https://www.reddit.com/r/travel/comments/1nznb81/5_days_in_chiang_mai_reflection_slower_pace_crisp/) | 17 | 15 | 15 | 0 | 2 | 1.00 | 0.88 | 0.94 |

**Aggregate (micro):** TP 73 · FP 1 · FN 7 → **P 0.986 · R 0.913 · F1 0.948**

**Per-sample failure detail**
- **#1 San Diego** — missed `Stonewall Peak` (an "optional, skip if tired" trail). Zero hallucinations.
- **#2 NYC** — extracted `La Boheme` as a place (it's the opera being performed *at* Metropolitan Opera House — the real venue was the missed item). Other misses: `Asbury Park`, `Long Branch`, `JFK Airport` — all briefly mentioned outside the main itinerary lines.
- **#3 Chiang Mai** — missed `Chang Phueak Gate` (mentioned only in a reply) and `Chiang Rai` (mentioned as a destination city for the temple excursion). Zero hallucinations; gpt-oss actually outperformed Claude here (Claude's GT missed the white/blue/black temples and the Thai-named buffet — those were added back during manual reconciliation).

**Notes on the methodology**
- Auto numbers were ~24 pts lower on F1 (0.757 → 0.948) — almost entirely from normalized-exact mismatches on short-form names (`Joe's`, `Blue Bottle`, `Zucker`, `The Edge`, `High Line`, `Birdhouse`, etc.). All of those resolve to the correct Google Places result downstream, so they don't hurt the actual product.
- LLM-as-judge (Claude as GT) is useful as a *draft* but not authoritative — Claude missed 5+ real places across the 3 files. Human verification against source is still required.

### Vision scan (`eval/screenshots/`)

Pipeline: `us.amazon.nova-premier-v1:0` drafts ground truth (chosen because `claude-opus-4-6` was blocked for this team's API key — Nova Premier is the strongest non-Claude vision model available on TritonAI, avoiding evaluating the production model against itself), `claude-sonnet-4-6` (production) runs in parallel, both via `eval/run-vision-scan.ts`. Raw outputs in `eval/screenshots/<name>.gt.json` and `<name>.actual.json`. Numbers below are after **manual reconciliation against the screenshots themselves** (Nova missed places Claude correctly extracted).

| # | File | True | Extracted | TP | FP | FN | P | R | F1 |
|---|---|------|-----------|----|----|----|------|------|------|
| 1 | highway1.jpg (PCH route map, SF→LA) | 9 | 9 | 9 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| 2 | roadtrip.jpg (Google Maps list, UT/AZ) | 9 | 9 | 9 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| 3 | seattle.jpg (Seattle↔Pullman map) | 7 | 7 | 7 | 0 | 0 | 1.00 | 1.00 | 1.00 |

**Aggregate (micro):** TP 25 · FP 0 · FN 0 → **P 1.00 · R 1.00 · F1 1.00**

**Per-sample detail**
- **#1 highway1** — Claude got all 9 labeled stops; Nova GT missed `Big Sur`. Neither model picked up the "Pacific Ocean" ocean label or "Highway 1" road label (correctly excluded as generic).
- **#2 roadtrip** — both models extracted exactly the 9 saved-list destinations (A–I) and correctly ignored the basemap labels for Phoenix / Las Vegas / San Diego (not part of the user's list).
- **#3 seattle** — Claude got all 7 destinations including `Sand Hollow Recreation Area`; Nova GT missed that one.

**Caveat on difficulty**
All three test images are essentially **map screenshots with clearly rendered text labels** — this is closer to OCR-with-filtering than the harder vision case the feature was designed for (RedNote / Instagram photo collages where place names appear only in handwritten captions or have to be inferred from visual cues). The 100% score should not be read as "vision is solved"; it shows the model handles the label-heavy case reliably. A future eval pass should add a few harder image-only samples.

### YouTube subtitles
| # | URL | Ground truth | Extracted | TP | FP | FN |
|---|---|---|---|---|---|---|
| 1 | https://www.youtube.com/watch?v=VVymQWez0A4&list=PLhScQrWKGgbvtgb_uGdLkTLIwrIHQdfQM&index=2 |  |  |  |  |  |
| 2 | https://www.youtube.com/watch?v=zgYMBduEY34&list=PLhScQrWKGgbvtgb_uGdLkTLIwrIHQdfQM&index=4 |  |  |  |  |  |

### Clip Pin
| # | Snippet | Expected | Extracted | Correct? |
|---|---|---|---|---|
| 1 | Bellagio |  |  |  |
| 2 | Caesars Palace |  |  |  |
| 3 | Sphere |  |  |  |

### Geocoding (sampled across the above)
| # | Name | Region | Expected lat/lng | Returned | Within 500 m? |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## Results

| Path | P | R | F1 |
|---|---|---|---|
| Text | 0.99 | 0.91 | 0.95 |
| Vision | 1.00 | 1.00 | 1.00 |
| YouTube | TBD | TBD | TBD |
| Clip Pin | — | — | acc TBD |
| Geocoding | — | — | acc TBD |

**Observations:** _failure modes + whether the design decisions in [`DESIGN.md`](./DESIGN.md) (region hint, English-forced output) measurably helped._
