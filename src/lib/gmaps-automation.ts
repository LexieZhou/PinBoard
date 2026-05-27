/**
 * Google Maps DOM automation — list-first approach.
 *
 * Three injected phases replace the old per-place navigateAndSave:
 *   1. setupList(listName)      — open /maps/saved, create the list, arrive at
 *                                 the "Search for a place to add" screen.
 *   2. addPlaceToList(name, addr) — type one query, pick the first result.
 *   3. finishList()             — click Done to save the list.
 *
 * Each function is injected via chrome.scripting.executeScript({ func, args })
 * and MUST be fully self-contained: helpers are duplicated inside each function
 * because executeScript serializes the function source.
 *
 * Fragile surface: Maps' DOM selectors. Keep all selectors here.
 * Targets the English Maps UI; aria/role fallbacks used where possible.
 */

export type SetupListResult = { ok: boolean; reason: string };
export type AddPlaceResult = { ok: boolean; reason: string };

// ─── Phase 1 ─────────────────────────────────────────────────────────────────

/**
 * Drive the Maps UI to create a new list:
 *   hamburger menu → Your places → Lists tab → New list → type name → Next
 * Finishes when "Search for a place to add" is visible.
 */
export async function setupList(listName: string): Promise<SetupListResult> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function waitFor<T>(
    get: () => T | null | undefined,
    timeoutMs: number,
    intervalMs = 200,
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = get();
      if (v) return v;
      if (Date.now() > deadline) return null;
      await sleep(intervalMs);
    }
  }

  const visible = (el: Element | null | undefined): boolean =>
    !!el && (el as HTMLElement).offsetParent !== null;

  function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function byText(selector: string, re: RegExp): HTMLElement | null {
    return (
      Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (el) => re.test(el.textContent || "") && visible(el),
      ) ?? null
    );
  }

  function detectLoginWall(): boolean {
    if (location.hostname === "accounts.google.com") return true;
    return !!document.querySelector('[data-value="Sign in"], [aria-label="Sign in"]');
  }

  if (detectLoginWall()) return { ok: false, reason: "not_logged_in" };

  // Step 1: open the hamburger / main menu.
  const menuBtn =
    document.querySelector<HTMLElement>('button[aria-label="Menu"]') ??
    document.querySelector<HTMLElement>('[aria-label="Main menu"]') ??
    byText('button,[role="button"]', /^menu$/i);
  if (!menuBtn) return { ok: false, reason: "menu_button_not_found" };
  menuBtn.click();
  await sleep(500);

  // Step 2: click "Your places".
  const yourPlaces = await waitFor(
    () =>
      document.querySelector<HTMLElement>('[jsaction="settings.yourplaces"]') ??
      byText('button,[role="menuitem"]', /^saved$/i),
    5000,
  );
  if (!yourPlaces) return { ok: false, reason: "your_places_not_found" };
  yourPlaces.click();
  await sleep(700);

  // Step 3: click "New list".
  const newListBtn = await waitFor(
    () =>
      document.querySelector<HTMLElement>('[aria-label*="New list" i]') ??
      byText('button,[role="button"]', /new list/i),
    6000,
  );
  if (!newListBtn) {
    return { ok: false, reason: detectLoginWall() ? "not_logged_in" : "new_list_button_not_found" };
  }
  newListBtn.click();
  await sleep(600);

  // Step 5: type the list name.
  const nameInput = await waitFor(
    () =>
      document.querySelector<HTMLInputElement>(
        'input[aria-label*="list title" i], input[placeholder*="list title" i], input[type="text"]:not([readonly])',
      ),
    5000,
  );
  if (!nameInput) return { ok: false, reason: "name_input_not_found" };
  setNativeValue(nameInput, listName);
  await sleep(200);

  // Step 6: click "Next" to advance to the place-search step (if present).
  const nextBtn = await waitFor(
    () => byText("button", /^\s*next\s*$/i),
    2500,
  );
  if (nextBtn) {
    nextBtn.click();
    await sleep(600);
  }

  // Step 7: confirm the place-search input is ready.
  const placeSearch = await waitFor(
    () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Search for a place to add"]'),
    6000,
  );
  if (!placeSearch) return { ok: false, reason: "place_search_not_found" };

  return { ok: true, reason: "ready" };
}

// ─── Phase 2 ─────────────────────────────────────────────────────────────────

/** Type one place query into "Search for a place to add" and click the first result. */
export async function addPlaceToList(name: string, address: string): Promise<AddPlaceResult> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function waitFor<T>(
    get: () => T | null | undefined,
    timeoutMs: number,
    intervalMs = 200,
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = get();
      if (v) return v;
      if (Date.now() > deadline) return null;
      await sleep(intervalMs);
    }
  }

  const visible = (el: Element | null | undefined): boolean =>
    !!el && (el as HTMLElement).offsetParent !== null;

  // Write a value through the React-style native setter and fire `input`.
  // No `change` event (Maps' combobox debounces on input, not change) and no
  // implicit focus — typeQuery handles focusing once at the start.
  function setNativeValue(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Simulate per-character typing: keydown → value+=char (with input event) → keyup,
  // with a small human-ish delay. Maps' Closure autocomplete arms its debounce
  // off the keystroke stream, not off bulk value replacement, so a single
  // setNativeValue with the whole string usually fails to fire predictions.
  async function typeQuery(input: HTMLInputElement, text: string) {
    input.focus();
    setNativeValue(input, "");
    await sleep(60);

    let cur = "";
    for (const ch of text) {
      cur += ch;
      const upper = ch.toUpperCase();
      const keyCode = upper.charCodeAt(0);
      const code = /[A-Z]/.test(upper)
        ? `Key${upper}`
        : /[0-9]/.test(ch)
          ? `Digit${ch}`
          : ch === " "
            ? "Space"
            : "";
      const opts: KeyboardEventInit = {
        key: ch,
        code,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
      };
      input.dispatchEvent(new KeyboardEvent("keydown", opts));
      setNativeValue(input, cur);
      input.dispatchEvent(new KeyboardEvent("keyup", opts));
      await sleep(45 + Math.floor(Math.random() * 35));
    }
  }

  // Including the resolved address disambiguates short/ambiguous names
  // ("Washing Potato", "Sphere"). Maps tolerates the redundancy.
  const query = address ? `${name} ${address}` : name;

  async function attemptOnce(): Promise<AddPlaceResult> {
    const searchInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search for a place to add"]',
    );
    if (!searchInput || !visible(searchInput)) {
      return { ok: false, reason: "search_input_not_found" };
    }

    await typeQuery(searchInput, query);
    await sleep(400);

    // Maps sometimes hangs aria-expanded on an ancestor combobox rather than
    // on the input itself; also accept a visible listbox/option as evidence
    // that the dropdown actually rendered.
    const expanded = await waitFor(() => {
      if (searchInput.getAttribute("aria-expanded") === "true") return true as const;
      let el: HTMLElement | null = searchInput.parentElement;
      while (el) {
        if (el.getAttribute?.("aria-expanded") === "true") return true as const;
        el = el.parentElement;
      }
      const candidate = Array.from(
        document.querySelectorAll<HTMLElement>('[role="listbox"], [role="option"]'),
      ).find((n) => visible(n));
      return candidate ? true : null;
    }, 6000);

    if (!expanded) {
      setNativeValue(searchInput, "");
      return { ok: false, reason: "no_results" };
    }

    const arrowOpts: KeyboardEventInit = {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
      which: 40,
      bubbles: true,
      cancelable: true,
    };
    searchInput.dispatchEvent(new KeyboardEvent("keydown", arrowOpts));
    searchInput.dispatchEvent(new KeyboardEvent("keyup", arrowOpts));
    await sleep(300);

    const enterOpts: KeyboardEventInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    searchInput.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
    searchInput.dispatchEvent(new KeyboardEvent("keyup", enterOpts));

    const cleared = await waitFor(() => (searchInput.value === "" ? true : null), 3500);
    await sleep(300);

    if (!cleared) {
      setNativeValue(searchInput, "");
      return { ok: false, reason: "place_not_added" };
    }
    return { ok: true, reason: "added" };
  }

  // One automatic retry: most failures here are timing/render races
  // (Maps remounts the input or hasn't armed predict yet after the previous
  // chip was added). Sleeping ~1s and re-querying the input fixes the
  // common cases without burning the user.
  const first = await attemptOnce();
  if (first.ok) return first;
  await sleep(1000);
  return attemptOnce();
}

// ─── Phase 3 ─────────────────────────────────────────────────────────────────

/** Click Done to commit the list. */
export async function finishList(): Promise<void> {
  const visible = (el: Element | null | undefined): boolean =>
    !!el && (el as HTMLElement).offsetParent !== null;

  const doneBtn =
    document.querySelector<HTMLElement>("button.pktOgc") ??
    Array.from(document.querySelectorAll<HTMLElement>("button")).find(
      (b) => /^\s*done\s*$/i.test(b.textContent || "") && visible(b),
    ) ??
    null;

  doneBtn?.click();
}
