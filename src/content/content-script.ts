import type { ClipPinResponse, RuntimeMessage } from "../lib/types";

// Render the floating "Add to PinBoard" button in a Shadow DOM so the host
// page's CSS can't bleed in (and ours can't bleed out).
const HOST_ID = "pinboard-clipper-floating-host";
const MIN_LEN = 2;
const MAX_LEN = 300;

type ButtonState = "idle" | "saving" | "saved" | "error";

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let buttonEl: HTMLButtonElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let iconEl: HTMLSpanElement | null = null;
let currentText = "";
let hideTimer: number | null = null;
let state: ButtonState = "idle";

function ensureMounted(): void {
  if (host) return;

  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = [
    "position: fixed",
    "top: 0",
    "left: 0",
    "width: 0",
    "height: 0",
    "z-index: 2147483647",
    "pointer-events: none",
  ].join(";");

  shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .pb-btn {
      position: fixed;
      transform: translate(-50%, -100%);
      margin-top: -8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px 6px 8px;
      border: none;
      border-radius: 999px;
      background: #18181b;
      color: #fff;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      letter-spacing: 0.01em;
      box-shadow: 0 4px 14px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.06) inset;
      cursor: pointer;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 120ms ease, transform 120ms ease, background-color 160ms ease;
      white-space: nowrap;
      user-select: none;
    }
    .pb-btn[data-visible="true"] {
      opacity: 1;
    }
    .pb-btn:hover { background: #27272a; }
    .pb-btn[data-state="saving"]  { background: #1f2937; cursor: progress; }
    .pb-btn[data-state="saved"]   { background: #059669; cursor: default; }
    .pb-btn[data-state="error"]   { background: #b91c1c; cursor: default; }
    .pb-btn .icon {
      display: inline-flex;
      width: 14px;
      height: 14px;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }
    .pb-btn .spin {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255,255,255,0.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: pb-spin 0.7s linear infinite;
    }
    @keyframes pb-spin { to { transform: rotate(360deg); } }
  `;
  shadow.appendChild(style);

  buttonEl = document.createElement("button");
  buttonEl.className = "pb-btn";
  buttonEl.type = "button";
  buttonEl.setAttribute("data-state", "idle");
  buttonEl.setAttribute("data-visible", "false");

  iconEl = document.createElement("span");
  iconEl.className = "icon";
  iconEl.textContent = "📍";

  labelEl = document.createElement("span");
  labelEl.textContent = "Add to PinBoard";

  buttonEl.appendChild(iconEl);
  buttonEl.appendChild(labelEl);
  shadow.appendChild(buttonEl);

  buttonEl.addEventListener("mousedown", (e) => {
    // Prevent the browser from clearing the active selection when the user
    // clicks the button — otherwise mousedown on the button collapses the
    // range and our `currentText` snapshot would already be empty by click.
    e.preventDefault();
    e.stopPropagation();
  });
  buttonEl.addEventListener("click", onClipClick);

  document.documentElement.appendChild(host);
}

function setState(next: ButtonState, label?: string, icon?: string): void {
  state = next;
  if (!buttonEl || !labelEl || !iconEl) return;
  buttonEl.setAttribute("data-state", next);
  if (label) labelEl.textContent = label;
  if (next === "saving") {
    iconEl.textContent = "";
    iconEl.innerHTML = '<span class="spin"></span>';
  } else if (icon) {
    iconEl.textContent = icon;
  }
}

function showAt(rect: DOMRect): void {
  ensureMounted();
  if (!buttonEl) return;
  const x = rect.left + rect.width / 2;
  const y = rect.top;
  buttonEl.style.left = `${x}px`;
  buttonEl.style.top = `${y}px`;
  buttonEl.setAttribute("data-visible", "true");
}

function hide(): void {
  if (!buttonEl) return;
  buttonEl.setAttribute("data-visible", "false");
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  // Reset to idle so the next selection starts fresh.
  setState("idle", "Add to PinBoard", "📍");
}

function isInsideHost(node: Node | null): boolean {
  if (!host) return false;
  let n: Node | null = node;
  while (n) {
    if (n === host) return true;
    n = (n as ChildNode).parentNode;
  }
  return false;
}

function updateFromSelection(): void {
  if (state === "saving" || state === "saved" || state === "error") return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    hide();
    return;
  }

  const text = sel.toString().trim();
  if (text.length < MIN_LEN || text.length > MAX_LEN) {
    hide();
    return;
  }

  // Skip selections inside our own button (Shadow DOM, but be defensive).
  if (isInsideHost(sel.anchorNode) || isInsideHost(sel.focusNode)) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hide();
    return;
  }

  currentText = text;
  showAt(rect);
}

async function onClipClick(): Promise<void> {
  if (!currentText || state !== "idle") return;

  setState("saving", "Saving…");

  const msg: RuntimeMessage = {
    type: "CLIP_PIN",
    selectedText: currentText,
    pageUrl: location.href,
    pageTitle: document.title || "",
  };

  let resp: ClipPinResponse;
  try {
    resp = (await chrome.runtime.sendMessage(msg)) as ClipPinResponse;
  } catch (err) {
    resp = {
      ok: false,
      error: String(err instanceof Error ? err.message : err),
    };
  }

  if (resp?.ok) {
    const suffix = resp.addedCount > 1 ? ` (+${resp.addedCount - 1} more)` : "";
    setState("saved", `✓ Saved ${truncate(resp.firstName, 28)}${suffix}`, "");
    if (iconEl) iconEl.textContent = "✓";
    hideTimer = window.setTimeout(hide, 1800);
  } else {
    const err = resp?.error || "Failed";
    setState("error", `× ${truncate(err, 40)}`, "");
    if (iconEl) iconEl.textContent = "×";
    hideTimer = window.setTimeout(hide, 2400);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Selection events fire on every keystroke too — debounce-by-rAF to avoid
// thrashing layout, and only react after the user releases the mouse so the
// button doesn't flicker mid-drag.
let pendingFrame: number | null = null;
function scheduleUpdate(): void {
  if (pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    updateFromSelection();
  });
}

document.addEventListener("mouseup", () => {
  // small delay so the selection has been finalized
  setTimeout(scheduleUpdate, 0);
});
document.addEventListener("keyup", (e) => {
  // arrow/shift-arrow keyboard selections
  if (e.shiftKey || e.key.startsWith("Arrow")) scheduleUpdate();
});
document.addEventListener("selectionchange", () => {
  // Only react to *collapsing* the selection here — opening selections are
  // handled by mouseup/keyup so the button doesn't jump while the user drags.
  if (state === "idle") {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hide();
  }
});

// Click anywhere outside the button dismisses any sticky result toast.
document.addEventListener("mousedown", (e) => {
  if (state === "saved" || state === "error") {
    if (e.target instanceof Node && !isInsideHost(e.target)) hide();
  }
});

// Reposition when the page scrolls/resizes so the button stays anchored to
// the selection (rect coords are viewport-relative, so we recompute).
window.addEventListener("scroll", scheduleUpdate, true);
window.addEventListener("resize", scheduleUpdate);
