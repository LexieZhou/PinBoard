import type { PageContent } from "./types";

// Description+transcript cap. Matches the slice in triton.ts so we don't waste
// tokens building text past what the LLM call will accept anyway.
const MAX_TEXT = 12000;

export function isYoutubeWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com") return false;
    return u.pathname === "/watch" || u.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/shorts\/([^/?]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

type YoutubeMeta =
  | {
      ok: true;
      title: string;
      description: string;
      // null when this video has no caption tracks at all. Downstream we still
      // try DOM-scrape and description-only fallbacks, so missing tracks at
      // this stage isn't fatal.
      captionBaseUrl: string | null;
    }
  | { ok: false; reason: string };

// Runs inside the YouTube tab (default ISOLATED world). We can't reach the
// page's `window.ytInitialPlayerResponse` from here, so we walk <script> tags
// and parse the JSON literal out of the raw text. Must be fully self-contained
// — chrome.scripting serializes this function via .toString() and any outer
// references would be undefined at execution time.
function readYoutubeMetaInPage(
  videoId: string,
): { ok: true; title: string; description: string; captionBaseUrl: string | null }
  | { ok: false; reason: string } {
  // Find the balanced { ... } literal that starts at the first '{' on/after startIdx.
  // Tracks string state so a literal '}' inside a string doesn't end the object.
  function extractJsonStartingAt(text: string, startIdx: number): string | null {
    let i = text.indexOf("{", startIdx);
    if (i < 0) return null;
    const start = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (ch === "\\") escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function findPlayerResponseInText(text: string, vid: string): unknown {
    // Only match the actual assignment site — `var ytInitialPlayerResponse = {`
    // or `window["ytInitialPlayerResponse"] = {`. Without this, YouTube's
    // minified bundles contain dozens of code references to the same name
    // (function bodies, getters), and brace-scanning from each one is O(n²)
    // on a multi-MB script — the side panel just hangs.
    const re = /ytInitialPlayerResponse(?:\s*=|["']\]\s*=)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const braceIdx = m.index + m[0].length - 1;
      const jsonStr = extractJsonStartingAt(text, braceIdx);
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr) as { videoDetails?: { videoId?: string } };
        if (parsed?.videoDetails?.videoId === vid) return parsed;
      } catch {
        // malformed match, keep scanning
      }
    }
    return null;
  }

  // Walk newest scripts first — SPA navigations sometimes leave stale earlier
  // scripts in the DOM, and the most recent one is the one for the current vid.
  const scripts = Array.from(document.scripts);
  let player: unknown = null;
  for (let i = scripts.length - 1; i >= 0; i--) {
    const txt = scripts[i].textContent;
    if (!txt || txt.indexOf("ytInitialPlayerResponse") < 0) continue;
    player = findPlayerResponseInText(txt, videoId);
    if (player) break;
  }

  if (!player) {
    return {
      ok: false,
      reason: "Couldn't read YouTube player data — try refreshing the video page.",
    };
  }

  const p = player as {
    videoDetails?: { title?: string; shortDescription?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          baseUrl?: string;
          languageCode?: string;
          kind?: string;
        }>;
      };
    };
  };

  const title = p.videoDetails?.title ?? document.title ?? "";
  const description = p.videoDetails?.shortDescription ?? "";
  const tracks = p.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  // No tracks: still return ok so the caller can fall back to DOM scrape
  // and/or description-only — losing captions isn't the end of the road.
  if (tracks.length === 0) {
    return { ok: true, title, description, captionBaseUrl: null };
  }

  // Prefer English manual → English auto → any manual → first.
  const pick =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.kind !== "asr") ||
    tracks[0];

  return {
    ok: true,
    title,
    description,
    captionBaseUrl: pick?.baseUrl ?? null,
  };
}

// SPA-stale fallback: if the page's script tags reference a different videoId
// than the current URL (user navigated client-side), fetch the watch page HTML
// directly so we get a guaranteed-fresh ytInitialPlayerResponse.
async function fetchMetaViaHtml(url: string, videoId: string): Promise<YoutubeMeta> {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) {
    return { ok: false, reason: `Couldn't load video page (HTTP ${resp.status}).` };
  }
  const html = await resp.text();

  // Only match the actual assignment, not stray code references — same reason
  // as in the in-page scanner: avoids O(n²) brace scans through minified JS.
  const re = /ytInitialPlayerResponse(?:\s*=|["']\]\s*=)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const braceIdx = m.index + m[0].length - 1;
    const jsonStr = balancedJsonAt(html, braceIdx);
    if (!jsonStr) continue;
    try {
      const parsed = JSON.parse(jsonStr) as {
        videoDetails?: { videoId?: string; title?: string; shortDescription?: string };
        captions?: {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
          };
        };
      };
      if (parsed?.videoDetails?.videoId !== videoId) continue;

      const tracks = parsed.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const pick =
        tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
        tracks.find((t) => t.languageCode === "en") ||
        tracks.find((t) => t.kind !== "asr") ||
        tracks[0];
      return {
        ok: true,
        title: parsed.videoDetails?.title ?? "",
        description: parsed.videoDetails?.shortDescription ?? "",
        captionBaseUrl: pick?.baseUrl ?? null,
      };
    } catch {
      // try next marker occurrence
    }
  }

  return { ok: false, reason: "Couldn't find player data in the video page." };
}

function balancedJsonAt(text: string, startIdx: number): string | null {
  let i = text.indexOf("{", startIdx);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

type Json3 = {
  events?: Array<{ segs?: Array<{ utf8?: string }> }>;
};

function parseJson3Transcript(json: Json3): string {
  if (!Array.isArray(json?.events)) return "";
  const lines: string[] = [];
  for (const ev of json.events) {
    if (!Array.isArray(ev.segs)) continue;
    const raw = ev.segs.map((s) => s.utf8 ?? "").join("");
    // Drop bracketed annotations ([Music], [Applause], [音乐]) — pure noise for NER.
    const cleaned = raw.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    // Auto-gen captions emit overlapping events where each new line repeats the
    // tail of the previous. Suppress exact-duplicate adjacent lines so we don't
    // burn token budget on the same phrase 3x.
    if (lines.length && lines[lines.length - 1] === cleaned) continue;
    lines.push(cleaned);
  }
  return lines.join("\n");
}

export async function fetchYoutubeContent(
  tabId: number,
  url: string,
): Promise<PageContent> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Couldn't determine YouTube video ID from URL.");
  }

  // Primary path: read straight from the live tab — cheapest, no extra fetch.
  let meta: YoutubeMeta | null = null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readYoutubeMetaInPage,
      args: [videoId],
    });
    const result = injection?.result as YoutubeMeta | undefined;
    if (result) meta = result;
  } catch {
    meta = null;
  }

  // Fallback: SPA navigation can leave stale script tags pointing at the old
  // video. If the in-page scan missed, refetch the watch page HTML directly.
  if (!meta || !meta.ok) {
    meta = await fetchMetaViaHtml(url, videoId);
  }

  if (!meta.ok) {
    throw new Error(meta.reason);
  }

  // Cascading transcript fetch: timedtext API → DOM scrape → description-only.
  // Each rung handles a real failure mode of the previous one:
  //   - API returns empty body when YouTube demands a `pot` (proof-of-origin)
  //     token, which it does for an increasing share of videos.
  //   - DOM scrape works for any video where YouTube renders the "Show
  //     transcript" button (= captions exist), but fails when the video has
  //     none at all.
  //   - Description-only is the last resort and is often surprisingly good for
  //     vloggers who list every place in the description anyway.
  let transcript = "";

  if (meta.captionBaseUrl) {
    try {
      transcript = await fetchTranscriptViaApi(meta.captionBaseUrl);
    } catch {
      // fall through
    }
  }

  if (!transcript) {
    try {
      transcript = await scrapeTranscriptViaDom(tabId);
    } catch {
      // fall through
    }
  }

  const description = meta.description.trim();
  if (!transcript && !description) {
    throw new Error(
      "Couldn't get any text from this video — no captions, no transcript panel, and no description.",
    );
  }

  // Description first: vloggers routinely list every place (with times) in the
  // description. The LLM weighs earlier content as the primary signal.
  const combined = [
    description ? `[Description]\n${description}` : "",
    transcript ? `[Transcript]\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    url,
    title: meta.title,
    text: combined.slice(0, MAX_TEXT),
  };
}

async function fetchTranscriptViaApi(captionBaseUrl: string): Promise<string> {
  // baseUrl ships with fmt=srv3 (YouTube's XML) by default. Overwrite, don't
  // skip when present, or we'd JSON.parse XML and crash.
  const u = new URL(captionBaseUrl);
  u.searchParams.set("fmt", "json3");

  const resp = await fetch(u.toString());
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const body = await resp.text();
  if (!body.trim()) {
    // 200 + empty body = YouTube wants a session/pot token. Caller falls back.
    throw new Error("empty");
  }
  const json = JSON.parse(body) as Json3;
  return parseJson3Transcript(json);
}

async function scrapeTranscriptViaDom(tabId: number): Promise<string> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeTranscriptInPage,
    args: [],
  });
  return (injection?.result as string | undefined) ?? "";
}

// Runs in the YouTube tab. Finds the "Show transcript" button, clicks it,
// polls until segments render, reads them out. Returns "" on any failure
// (no button, timeout, etc.) so the caller can fall back. Leaves the panel
// open afterwards — the user can see what we read; they close it manually.
function scrapeTranscriptInPage(): Promise<string> {
  return new Promise((resolve) => {
    const readSegments = (): string => {
      const segs = Array.from(
        document.querySelectorAll<HTMLElement>(
          "ytd-transcript-segment-renderer .segment-text, ytd-transcript-segment-renderer yt-formatted-string",
        ),
      );
      if (segs.length === 0) return "";
      const lines: string[] = [];
      let prev = "";
      for (const seg of segs) {
        const t = (seg.textContent || "").replace(/\s+/g, " ").trim();
        if (!t || t === prev) continue;
        prev = t;
        lines.push(t);
      }
      return lines.join("\n");
    };

    // Maybe the panel is already open from a previous scan.
    const existing = readSegments();
    if (existing) {
      resolve(existing);
      return;
    }

    // Find the open-transcript button. YouTube uses both `<button>` and
    // `<tp-yt-paper-button>`; aria-label is the most stable signal, but on
    // some locales the button has only inner text. We exclude the player's
    // CC toggle (which lives under .ytp-chrome-controls) to avoid clicking
    // the wrong thing.
    const findOpenButton = (): HTMLElement | null => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, tp-yt-paper-button, [role="button"]',
        ),
      );
      const re = /transcript|文字记录|文字記録|文字起こし|자막 기록/i;
      for (const b of candidates) {
        if (b.closest(".ytp-chrome-controls")) continue;
        const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`;
        if (re.test(label)) return b;
      }
      return null;
    };

    const btn = findOpenButton();
    if (!btn) {
      resolve("");
      return;
    }
    btn.click();

    // Segments render lazily after the panel mounts — usually <1s, occasionally
    // up to 3-4s on slow networks. Poll for ~8s before giving up.
    const start = Date.now();
    const tick = () => {
      const t = readSegments();
      if (t) {
        resolve(t);
        return;
      }
      if (Date.now() - start > 8000) {
        resolve("");
        return;
      }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 300);
  });
}
