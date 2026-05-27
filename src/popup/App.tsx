import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import ListBar from "./ListBar";
import {
  addList,
  clearActiveList,
  deleteList,
  loadStore,
  removePinFromList,
  renameList,
  setActiveList,
  type Store,
} from "../lib/pin-store";
import type {
  ExtractedLocation,
  GmapsFailure,
  GmapsSendResponse,
  List,
  PageContent,
  Pin,
  PinResponse,
  ScanResponse,
} from "../lib/types";
import { CATEGORY_CONFIG } from "../lib/categories";

type ScanMode = "text" | "vision";

type Phase =
  | { kind: "idle" }
  | { kind: "scanning"; mode: ScanMode }
  | { kind: "preview"; locations: ExtractedLocation[]; pageContent: PageContent; selected: Set<number> }
  | { kind: "pinning" }
  | { kind: "done"; addedCount: number }
  | { kind: "sending"; done: number; total: number; name: string }
  | { kind: "sentResult"; saved: number; failed: GmapsFailure[] }
  | { kind: "error"; message: string };

export default function App() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [activeListId, setActiveListId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    loadStore().then(applyStore);
  }, []);

  useEffect(() => {
    // Auto-refresh when the content script clips a pin (or anything else
    // mutates storage) so the side panel stays in sync without re-opening.
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== "local") return;
      if (
        "pinboard.pins.v1" in changes ||
        "pinboard.lists.v1" in changes ||
        "pinboard.activeListId.v1" in changes
      ) {
        loadStore().then(applyStore);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    const listener = (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: string }).type === "GMAPS_PROGRESS"
      ) {
        const m = msg as { done: number; total: number; name: string };
        setPhase((prev) =>
          prev.kind === "sending"
            ? { kind: "sending", done: m.done, total: m.total, name: m.name }
            : prev,
        );
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  function applyStore(s: Store) {
    setPins(s.pins);
    setLists(s.lists);
    setActiveListId(s.activeListId);
  }

  const visiblePins = useMemo(
    () => pins.filter((p) => p.listIds.includes(activeListId)),
    [pins, activeListId],
  );

  const activeList = lists.find((l) => l.id === activeListId);

  async function runScan(mode: ScanMode) {
    setPhase({ kind: "scanning", mode });
    const type = mode === "vision" ? "SCAN_VISIBLE_AREA" : "SCAN_ACTIVE_TAB";
    const resp = (await chrome.runtime.sendMessage({ type })) as ScanResponse;
    if (!resp.ok) {
      setPhase({ kind: "error", message: resp.error });
      return;
    }
    if (resp.result.locations.length === 0) {
      const message =
        mode === "vision"
          ? "No specific places found in the screenshot. Try scrolling to a different part of the page."
          : "No specific places found on this page.";
      setPhase({ kind: "error", message });
      return;
    }
    setPhase({
      kind: "preview",
      locations: resp.result.locations,
      pageContent: resp.result.pageContent,
      selected: new Set(resp.result.locations.map((_, i) => i)),
    });
  }

  const handleScan = () => runScan("text");
  const handleScanVision = () => runScan("vision");

  async function handlePin() {
    if (phase.kind !== "preview" || !activeListId) return;
    const chosen = phase.locations.filter((_, i) => phase.selected.has(i));
    if (chosen.length === 0) return;
    const beforeCount = pins.filter((p) => p.listIds.includes(activeListId)).length;
    setPhase({ kind: "pinning" });
    const resp = (await chrome.runtime.sendMessage({
      type: "GEOCODE_AND_PIN",
      locations: chosen,
      pageContent: phase.pageContent,
      targetListId: activeListId,
    })) as PinResponse;
    if (!resp.ok) {
      setPhase({ kind: "error", message: resp.error });
      return;
    }
    setPins(resp.pins);
    const afterCount = resp.pins.filter((p) => p.listIds.includes(activeListId)).length;
    setPhase({ kind: "done", addedCount: afterCount - beforeCount });
  }

  function toggleSelected(idx: number) {
    if (phase.kind !== "preview") return;
    const next = new Set(phase.selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setPhase({ ...phase, selected: next });
  }

  async function handleSelectList(id: string) {
    setActiveListId(id);
    await setActiveList(id);
    if (phase.kind === "done" || phase.kind === "error") setPhase({ kind: "idle" });
  }

  async function handleCreateList(name: string) {
    const s = await addList(name);
    applyStore(s);
    setPhase({ kind: "idle" });
  }

  async function handleRenameList(id: string, name: string) {
    const s = await renameList(id, name);
    applyStore(s);
  }

  async function handleDeleteList(id: string) {
    const s = await deleteList(id);
    applyStore(s);
  }

  async function handleRemoveFromList(pinId: string) {
    if (!activeListId) return;
    const next = await removePinFromList(pinId, activeListId);
    setPins(next);
  }

  async function handleClearActive() {
    if (!activeList) return;
    if (!confirm(`Remove all pins from "${activeList.name}"?`)) return;
    const next = await clearActiveList(activeListId);
    setPins(next);
    setPhase({ kind: "idle" });
  }

  async function handleSendToGmaps() {
    if (!activeList || visiblePins.length === 0) return;
    setPhase({ kind: "sending", done: 0, total: visiblePins.length, name: "" });
    const resp = (await chrome.runtime.sendMessage({
      type: "SEND_TO_GMAPS",
      pins: visiblePins,
      listName: activeList.name,
    })) as GmapsSendResponse;
    if (!resp.ok) {
      setPhase({ kind: "error", message: resp.error });
      return;
    }
    setPhase({ kind: "sentResult", saved: resp.saved, failed: resp.failed });
  }

  return (
    <div className="flex flex-col h-screen w-full min-w-[320px] bg-white text-zinc-900">
      <header className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          <div>
            <div className="text-[11px] text-zinc-500">
              {pins.length} pin{pins.length === 1 ? "" : "s"} · {lists.length} list
              {lists.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        {visiblePins.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSendToGmaps}
              disabled={phase.kind === "sending"}
              className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700 disabled:text-zinc-300"
              title="Auto-save these pins to a Google Maps list (opens Google Maps)"
            >
              → Google Maps
            </button>
            <button
              onClick={() => exportKML(visiblePins, activeList?.name ?? "pins")}
              className="text-[11px] text-zinc-400 hover:text-blue-500"
              title="Export as KML for Google My Maps"
            >
              export .kml
            </button>
            <button
              onClick={handleClearActive}
              className="text-[11px] text-zinc-400 hover:text-rose-500"
            >
              clear list
            </button>
          </div>
        )}
      </header>

      <ListBar
        lists={lists}
        pins={pins}
        activeListId={activeListId}
        onSelect={handleSelectList}
        onCreate={handleCreateList}
        onRename={handleRenameList}
        onDelete={handleDeleteList}
      />

      <div className="flex-1 min-h-[260px] border-b border-zinc-200">
        <MapView pins={visiblePins} />
      </div>

      <div className="flex-1 min-h-[220px] overflow-y-auto">
        <ActionPanel
          phase={phase}
          pins={visiblePins}
          activeListName={activeList?.name ?? ""}
          onScan={handleScan}
          onScanVision={handleScanVision}
          onPin={handlePin}
          onToggle={toggleSelected}
          onRemove={handleRemoveFromList}
          onReset={() => setPhase({ kind: "idle" })}
        />
      </div>
    </div>
  );
}

function ActionPanel({
  phase,
  pins,
  activeListName,
  onScan,
  onScanVision,
  onPin,
  onToggle,
  onRemove,
  onReset,
}: {
  phase: Phase;
  pins: Pin[];
  activeListName: string;
  onScan: () => void;
  onScanVision: () => void;
  onPin: () => void;
  onToggle: (i: number) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
}) {
  const recentPins = useMemo(
    () => [...pins].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)).slice(0, 50),
    [pins],
  );

  if (phase.kind === "scanning") {
    const label =
      phase.mode === "vision"
        ? "Capturing screenshot and asking Claude…"
        : "Reading page and asking TritonAI…";
    return <StatusRow label={label} spinning />;
  }

  if (phase.kind === "pinning") {
    return <StatusRow label="Geocoding and saving pins…" spinning />;
  }

  if (phase.kind === "sending") {
    const pct = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
    return (
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-600">
          <span className="inline-block size-3 rounded-full border-2 border-zinc-300 border-t-emerald-500 animate-spin" />
          Saving to Google Maps… {phase.done}/{phase.total}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {phase.name && (
          <div className="mt-1.5 truncate text-[10px] text-zinc-400">{phase.name}</div>
        )}
        <div className="mt-2 text-[10px] text-zinc-400">
          Watch the Google Maps tab — keep it open until this finishes.
        </div>
      </div>
    );
  }

  if (phase.kind === "sentResult") {
    return (
      <div className="p-3">
        <div className="mb-2 flex items-start justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>
            Saved {phase.saved} place{phase.saved === 1 ? "" : "s"} to your Google Maps list.
          </span>
          <button
            onClick={onReset}
            className="shrink-0 text-emerald-700/60 hover:text-emerald-900"
            title="Dismiss"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
        {phase.failed.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            <div className="mb-1 font-semibold">
              {phase.failed.length} couldn't be saved — try again, or use export .kml.
            </div>
            <ul className="space-y-0.5">
              {phase.failed.slice(0, 8).map((f, i) => (
                <li key={`${f.name}-${i}`} className="truncate">
                  • {f.name} <span className="text-amber-600">({f.reason})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="p-3">
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <div className="font-semibold mb-1">Something went wrong</div>
          <div className="break-words">{phase.message}</div>
        </div>
        <button
          onClick={onReset}
          className="mt-3 w-full rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase.kind === "preview") {
    const selectedCount = phase.selected.size;
    return (
      <div className="p-3">
        <div className="text-[11px] text-zinc-500 mb-2">
          Found <span className="font-semibold text-zinc-900">{phase.locations.length}</span> location
          {phase.locations.length === 1 ? "" : "s"}. New pins will be added to{" "}
          <span className="font-semibold text-zinc-900">{activeListName || "the active list"}</span>.
        </div>
        <ul className="space-y-1.5 mb-3">
          {phase.locations.map((loc, i) => {
            const checked = phase.selected.has(i);
            const cat = CATEGORY_CONFIG[loc.category ?? "other"];
            return (
              <li key={`${loc.name}-${i}`}>
                <label className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(i)}
                    className="mt-0.5 accent-rose-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        style={{ background: cat.bg }}
                        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold text-white leading-tight"
                      >
                        {cat.emoji} {cat.label}
                      </span>
                      <span className="text-xs font-medium leading-tight truncate">{loc.name}</span>
                    </div>
                    {loc.contextSnippet && (
                      <div className="text-[10px] text-zinc-500 leading-snug line-clamp-2">
                        {loc.contextSnippet}
                      </div>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        <button
          onClick={onPin}
          disabled={selectedCount === 0}
          className="w-full rounded-md bg-rose-500 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-600 disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          Pin {selectedCount} to {activeListName || "list"}
        </button>
      </div>
    );
  }

  // done or idle
  return (
    <div className="p-3">
      {phase.kind === "done" ? (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>Added {phase.addedCount} to {activeListName || "list"}.</span>
          <button
            onClick={onReset}
            className="shrink-0 text-emerald-700/60 hover:text-emerald-900"
            title="Dismiss"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <button
            onClick={onScan}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
          >
            Scan this page for locations
          </button>
          <button
            onClick={onScanVision}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            title="Screenshot the current viewport and extract places with a vision model — useful for image-heavy posts (Xiaohongshu, Instagram screenshots, photo grids)."
          >
            📷 Scan visible area (vision)
          </button>
        </div>
      )}

      {recentPins.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400 mb-1.5">
            Pins in {activeListName}
          </div>
          <ul className="space-y-1">
            {recentPins.map((p) => {
              const cat = CATEGORY_CONFIG[p.category ?? "other"];
              return (
                <li
                  key={p.id}
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50"
                >
                  <span
                    style={{ background: cat.bg }}
                    className="mt-0.5 shrink-0 inline-flex items-center justify-center rounded-full w-5 h-5 text-[11px]"
                    title={cat.label}
                  >
                    {cat.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    {p.address && (
                      <div className="text-[10px] text-zinc-500 truncate">{p.address}</div>
                    )}
                  </div>
                  <button
                    onClick={() => onRemove(p.id)}
                    className="text-[10px] text-zinc-300 group-hover:text-rose-500"
                    title="Remove from this list"
                    aria-label="Remove from this list"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-500">
          No pins in {activeListName || "this list"} yet.
        </div>
      )}
    </div>
  );
}

function exportKML(pins: Pin[], listName: string) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const placemarks = pins
    .map(
      (p) => `
    <Placemark>
      <name>${esc(p.name)}</name>
      <description>${[p.address, p.contextSnippet, p.sourceUrl].filter(Boolean).map(esc).join("\n")}</description>
      <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
    </Placemark>`,
    )
    .join("");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(listName)}</name>${placemarks}
  </Document>
</kml>`;

  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${listName.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "pins"}.kml`;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusRow({ label, spinning }: { label: string; spinning?: boolean }) {
  return (
    <div className="flex items-center gap-2 p-4 text-xs text-zinc-600">
      {spinning && (
        <span className="inline-block size-3 rounded-full border-2 border-zinc-300 border-t-rose-500 animate-spin" />
      )}
      {label}
    </div>
  );
}
