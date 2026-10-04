/**
 * Cloudflare Turnstile in the browser. The script loads on the first form write, never with the page. The widget
 * runs in execute mode inside one fixed container and stays invisible unless Cloudflare asks for a challenge.
 */
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

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

/**
 * A single-use token for the form write named `action` (the route's bucket name, which the Worker checks against
 * Cloudflare's answer), or `null` when no site key is set or Cloudflare cannot be reached. The Worker decides what a
 * missing token means.
 */
export async function getTurnstileToken(action: string): Promise<string | null> {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (siteKey === undefined || siteKey === "") return null;
  const api = await loadScript();
  if (api === null) return null;
  return new Promise((resolve) => {
    // A callback that fired before `render` returned would find no id to remove.
    const widget: { id?: string } = {};
    const settle = (token: string | null) => {
      if (widget.id !== undefined) api.remove(widget.id);
      resolve(token);
    };
    widget.id = api.render(container(), {
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
    });
    api.execute(widget.id);
  });
}
