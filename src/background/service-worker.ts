import { extractLocations } from "../lib/triton";
import { geocodeMany } from "../lib/places";
import { addPins } from "../lib/pin-store";
import type {
  PageContent,
  Pin,
  PinResponse,
  RuntimeMessage,
  ScanResponse,
} from "../lib/types";

const TRITON_KEY = import.meta.env.VITE_TRITON_API_KEY ?? "";
const PLACES_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("sidePanel.setPanelBehavior failed:", err));
});

async function readActiveTabContent(): Promise<PageContent> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (): PageContent => {
      const main =
        document.querySelector("article") ||
        document.querySelector('[role="main"]') ||
        document.querySelector("main") ||
        document.body;
      return {
        url: location.href,
        title: document.title || "",
        text: (main as HTMLElement).innerText || "",
      };
    },
  });

  if (!injection?.result) throw new Error("Failed to read page content");
  return injection.result;
}

async function handleScan(): Promise<ScanResponse> {
  try {
    const pageContent = await readActiveTabContent();
    const locations = await extractLocations(pageContent.text, pageContent.title, TRITON_KEY);
    return { ok: true, result: { pageContent, locations } };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

async function handlePin(
  locations: { name: string; contextSnippet: string }[],
  pageContent: PageContent,
  targetListId: string,
): Promise<PinResponse> {
  try {
    const cityHint = pageContent.title;
    const geocoded = await geocodeMany(locations, PLACES_KEY, cityHint);
    const now = new Date().toISOString();
    const newPins: Pin[] = geocoded.map((g) => ({
      id: crypto.randomUUID(),
      name: g.name,
      lat: g.lat,
      lng: g.lng,
      placeId: g.placeId,
      address: g.address,
      sourceUrl: pageContent.url,
      sourceTitle: pageContent.title,
      contextSnippet: g.contextSnippet,
      savedAt: now,
      listIds: [targetListId],
    }));
    const merged = await addPins(newPins, targetListId);
    return { ok: true, pins: merged };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg?.type === "SCAN_ACTIVE_TAB") {
    handleScan().then(sendResponse);
    return true;
  }
  if (msg?.type === "GEOCODE_AND_PIN") {
    handlePin(msg.locations, msg.pageContent, msg.targetListId).then(sendResponse);
    return true;
  }
  return false;
});
