/**
 * Cloudflare Turnstile in the browser. The script loads on the first form write, never with the page. The widget
 * runs in execute mode inside one fixed container and stays invisible unless Cloudflare asks for a challenge; when it
 * asks, a line above the box says so, and no form ever waits on Cloudflare for longer than `TOKEN_WAIT_MS`.
 */
import { t } from "./strings";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The longest a form waits for a token before it goes on without one (the Worker then decides). Without it, a
 * challenge nobody saw kept the sign-in button waiting for good, and no link was ever sent (P-3699).
 */
const TOKEN_WAIT_MS = 180_000;

const ASKING = "turnstile-host--asking";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      execution: "execute";
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
      "before-interactive-callback": () => void;
      "after-interactive-callback": () => void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi | null> | undefined;

function loadScript(): Promise<TurnstileApi | null> {
  loading ??= new Promise((resolve) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      resolve(window.turnstile ?? null);
    };
    script.onerror = () => {
      // A blocked script is not final: the next write tries again.
      loading = undefined;
      resolve(null);
    };
    document.head.append(script);
  });
  return loading;
}

function container(): HTMLElement {
  const existing = document.getElementById("turnstile-host");
  if (existing) return existing;
  const host = document.createElement("div");
  host.id = "turnstile-host";
  host.className = "turnstile-host";
  document.body.append(host);
  return host;
}

/** Cloudflare wants the visitor to tick its box: say so above it, read out by screen readers. */
function showAsk(host: HTMLElement): void {
  host.classList.add(ASKING);
  if (host.querySelector(".turnstile-ask")) return;
  const line = document.createElement("p");
  line.className = "turnstile-ask";
  line.setAttribute("role", "status");
  line.textContent = t.forms.turnstileAsk;
  host.prepend(line);
}

function hideAsk(host: HTMLElement): void {
  host.classList.remove(ASKING);
  host.querySelector(".turnstile-ask")?.remove();
}

/**
 * A single-use token for the form write named `action` (the route's bucket name, which the Worker checks against
 * Cloudflare's answer), or `null` when no site key is set, Cloudflare cannot be reached or no answer comes within
 * `TOKEN_WAIT_MS`. The Worker decides what a missing token means.
 */
export async function getTurnstileToken(action: string): Promise<string | null> {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (siteKey === undefined || siteKey === "") return null;
  const api = await loadScript();
  if (api === null) return null;
  const host = container();
  return new Promise((resolve) => {
    // A callback that fired before `render` returned would find no id to remove.
    const widget: { id?: string } = {};
    let settled = false;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      hideAsk(host);
      if (widget.id !== undefined) api.remove(widget.id);
      resolve(token);
    };
    const timer = window.setTimeout(() => {
      settle(null);
    }, TOKEN_WAIT_MS);
    widget.id = api.render(host, {
      sitekey: siteKey,
      action,
      execution: "execute",
      appearance: "interaction-only",
      callback: (token) => {
        settle(token);
      },
      "error-callback": () => {
        settle(null);
      },
      "timeout-callback": () => {
        settle(null);
      },
      "before-interactive-callback": () => {
        showAsk(host);
      },
      "after-interactive-callback": () => {
        hideAsk(host);
      },
    });
    api.execute(widget.id);
  });
}
