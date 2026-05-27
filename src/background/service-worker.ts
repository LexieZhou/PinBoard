import { extractLocations } from "../lib/triton";
import { geocodeMany } from "../lib/places";
import { addPins } from "../lib/pin-store";
import { setupList, addPlaceToList, finishList } from "../lib/gmaps-automation";
import type { SetupListResult, AddPlaceResult } from "../lib/gmaps-automation";
import type {
  ExtractedLocation,
  GmapsFailure,
  GmapsSendResponse,
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

// Disable navigation preload — this extension SW has no fetch handler and never
// consumes preloadResponse, so Chrome would log a warning on every navigation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.addEventListener("activate", (event: any) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event.waitUntil((self as any).registration?.navigationPreload?.disable?.() ?? Promise.resolve());
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
  locations: ExtractedLocation[],
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
      category: g.category ?? "other",
    }));
    const merged = await addPins(newPins, targetListId);
    return { ok: true, pins: merged };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

function waitForTabLoad(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out loading Google Maps"));
    }, timeoutMs);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function reasonToMessage(reason: string): string {
  switch (reason) {
    case "not_logged_in":
      return "Please log into Google Maps first, then try again.";
    case "menu_button_not_found":
      return "Couldn't find the Maps menu button.";
    case "your_places_not_found":
      return "Couldn't find 'Your places' in the Maps menu.";
    case "new_list_button_not_found":
      return "Couldn't find the New List button (Maps UI may have changed).";
    case "name_input_not_found":
      return "Couldn't find the list name input.";
    case "place_search_not_found":
      return "Couldn't open the place search field after creating the list.";
    case "search_input_not_found":
      return "Place search field disappeared (try again).";
    case "no_results":
      return "No search results found for this place.";
    default:
      return reason;
  }
}

async function handleSendToGmaps(
  pins: Pin[],
  listName: string,
): Promise<GmapsSendResponse> {
  if (pins.length === 0) return { ok: false, error: "No pins to send." };

  let tab: chrome.tabs.Tab;
  try {
    // Open the Saved Places page so the "New list" button is immediately available.
    tab = await chrome.tabs.create({ url: "https://www.google.com/maps/", active: true });
    if (!tab.id) throw new Error("Could not open a Google Maps tab");
    await waitForTabLoad(tab.id);
    await new Promise((r) => setTimeout(r, 1800));
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
  const tabId = tab.id;

  // Phase 1: create the list and arrive at the "Search for a place to add" screen.
  const [setupInjection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: setupList,
    args: [listName],
  });
  const setupResult = setupInjection?.result as SetupListResult | undefined;
  if (!setupResult?.ok) {
    const reason = setupResult?.reason ?? "unknown";
    return { ok: false, error: reasonToMessage(reason) };
  }

  // Phase 2: add each place via the search combobox, reporting progress per pin.
  let saved = 0;
  const failed: GmapsFailure[] = [];

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    try {
      const [addInjection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: addPlaceToList,
        args: [pin.name, pin.address],
      });
      const addResult = addInjection?.result as AddPlaceResult | undefined;

      if (addResult?.ok) {
        saved++;
      } else {
        failed.push({ name: pin.name, reason: reasonToMessage(addResult?.reason ?? "unknown") });
      }
    } catch (err) {
      failed.push({ name: pin.name, reason: String(err instanceof Error ? err.message : err) });
    }

    chrome.runtime
      .sendMessage({ type: "GMAPS_PROGRESS", done: i + 1, total: pins.length, name: pin.name })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
  }

  // Phase 3: commit the list.
  await chrome.scripting.executeScript({ target: { tabId }, func: finishList, args: [] });

  return { ok: true, saved, failed };
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
  if (msg?.type === "SEND_TO_GMAPS") {
    handleSendToGmaps(msg.pins, msg.listName).then(sendResponse);
    return true;
  }
  return false;
});
