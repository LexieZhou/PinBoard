import type { List, Pin } from "./types";

const PINS_KEY = "pinboard.pins.v1";
const LISTS_KEY = "pinboard.lists.v1";
const ACTIVE_LIST_KEY = "pinboard.activeListId.v1";
const DEFAULT_LIST_NAME = "My Pins";

export type Store = {
  pins: Pin[];
  lists: List[];
  activeListId: string;
};

export async function loadStore(): Promise<Store> {
  const result = await chrome.storage.local.get([PINS_KEY, LISTS_KEY, ACTIVE_LIST_KEY]);

  let lists: List[] = Array.isArray(result[LISTS_KEY]) ? (result[LISTS_KEY] as List[]) : [];
  let pins: Pin[] = Array.isArray(result[PINS_KEY]) ? (result[PINS_KEY] as Pin[]) : [];
  let activeListId: string =
    typeof result[ACTIVE_LIST_KEY] === "string" ? (result[ACTIVE_LIST_KEY] as string) : "";

  let mutated = false;

  if (lists.length === 0) {
    const defaultList: List = {
      id: crypto.randomUUID(),
      name: DEFAULT_LIST_NAME,
      createdAt: new Date().toISOString(),
    };
    lists = [defaultList];
    mutated = true;
  }

  if (!activeListId || !lists.some((l) => l.id === activeListId)) {
    activeListId = lists[0].id;
    mutated = true;
  }

  const validIds = new Set(lists.map((l) => l.id));
  const migratedPins = pins.map((p) => {
    const existing = Array.isArray(p.listIds) ? p.listIds.filter((id) => validIds.has(id)) : [];
    if (existing.length === 0) return { ...p, listIds: [activeListId] };
    return { ...p, listIds: existing };
  });
  if (migratedPins.some((p, i) => p !== pins[i])) {
    pins = migratedPins;
    mutated = true;
  }

  if (mutated) {
    await chrome.storage.local.set({
      [PINS_KEY]: pins,
      [LISTS_KEY]: lists,
      [ACTIVE_LIST_KEY]: activeListId,
    });
  }

  return { pins, lists, activeListId };
}

async function savePins(pins: Pin[]): Promise<void> {
  await chrome.storage.local.set({ [PINS_KEY]: pins });
}

async function saveLists(lists: List[]): Promise<void> {
  await chrome.storage.local.set({ [LISTS_KEY]: lists });
}

export async function setActiveList(listId: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_LIST_KEY]: listId });
}

export async function addList(name: string): Promise<Store> {
  const store = await loadStore();
  const trimmed = name.trim();
  if (!trimmed) return store;
  const list: List = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: new Date().toISOString(),
  };
  const lists = [...store.lists, list];
  await saveLists(lists);
  await setActiveList(list.id);
  return { ...store, lists, activeListId: list.id };
}

export async function renameList(listId: string, newName: string): Promise<Store> {
  const store = await loadStore();
  const trimmed = newName.trim();
  if (!trimmed) return store;
  const lists = store.lists.map((l) => (l.id === listId ? { ...l, name: trimmed } : l));
  await saveLists(lists);
  return { ...store, lists };
}

export async function deleteList(listId: string): Promise<Store> {
  const store = await loadStore();
  if (store.lists.length <= 1) return store;

  const lists = store.lists.filter((l) => l.id !== listId);
  const nextActive =
    store.activeListId === listId ? lists[0].id : store.activeListId;

  const pins = store.pins.map((p) => {
    const remaining = p.listIds.filter((id) => id !== listId);
    if (remaining.length === 0) return { ...p, listIds: [nextActive] };
    return { ...p, listIds: remaining };
  });

  await chrome.storage.local.set({
    [LISTS_KEY]: lists,
    [PINS_KEY]: pins,
    [ACTIVE_LIST_KEY]: nextActive,
  });
  return { lists, pins, activeListId: nextActive };
}

/**
 * Add or merge pins. If a pin with the same placeId already exists, union its
 * listIds with the new one (so re-pinning into a different list "tags" rather
 * than duplicates).
 */
export async function addPins(newPins: Pin[], targetListId: string): Promise<Pin[]> {
  const store = await loadStore();
  const byPlaceId = new Map(store.pins.map((p) => [p.placeId, p]));

  for (const incoming of newPins) {
    const existing = byPlaceId.get(incoming.placeId);
    if (existing) {
      const mergedListIds = Array.from(new Set([...existing.listIds, targetListId]));
      byPlaceId.set(incoming.placeId, { ...existing, listIds: mergedListIds });
    } else {
      byPlaceId.set(incoming.placeId, { ...incoming, listIds: [targetListId] });
    }
  }

  const merged = Array.from(byPlaceId.values());
  await savePins(merged);
  return merged;
}

export async function deletePin(id: string): Promise<Pin[]> {
  const store = await loadStore();
  const next = store.pins.filter((p) => p.id !== id);
  await savePins(next);
  return next;
}

/**
 * Remove a pin from a single list (untag). If the pin ends up in no lists, it
 * is fully deleted.
 */
export async function removePinFromList(pinId: string, listId: string): Promise<Pin[]> {
  const store = await loadStore();
  const next: Pin[] = [];
  for (const p of store.pins) {
    if (p.id !== pinId) {
      next.push(p);
      continue;
    }
    const remaining = p.listIds.filter((id) => id !== listId);
    if (remaining.length > 0) next.push({ ...p, listIds: remaining });
  }
  await savePins(next);
  return next;
}

export async function clearActiveList(activeListId: string): Promise<Pin[]> {
  const store = await loadStore();
  const next: Pin[] = [];
  for (const p of store.pins) {
    const remaining = p.listIds.filter((id) => id !== activeListId);
    if (remaining.length > 0) next.push({ ...p, listIds: remaining });
  }
  await savePins(next);
  return next;
}
