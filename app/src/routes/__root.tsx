import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import { NotFound } from "../components/layout/not-found";
import { RouteError } from "../components/layout/route-error";
import { SiteChrome } from "../components/layout/site-chrome";
import { absoluteUrl, siteConfig } from "../config/site";
import { ogStaticQuery, siteQuery } from "../lib/queries";
import { defaultLocale, localeDirection } from "../lib/strings";
import { ACCESS_BOOTSTRAP } from "../lib/access-bootstrap";
import { services } from "../services";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The site identity (`useSite()` reads it from this match) and the newer Open Graph cards (`ogStaticOf()` reads
  // `ogStatic` from the same match for every route head): one loader, both shapes.
  loader: async ({ context: { queryClient } }) => {
    const [site, ogStatic] = await Promise.all([
      queryClient.query({ ...siteQuery(), staleTime: "static" }),
      queryClient.query({ ...ogStaticQuery(), staleTime: "static" }),
    ]);
    return { ...site, ogStatic };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: siteConfig.name },
      { name: "theme-color", content: "#F5F2EB" },
      { property: "og:site_name", content: siteConfig.name },
      { property: "og:locale", content: "en_US" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "alternate", type: "application/rss+xml", title: siteConfig.name, href: "/feed.xml" },
      {
        rel: "alternate",
        type: "application/feed+json",
        title: siteConfig.name,
        href: "/feed.json",
      },
      // The guide for answer engines, named in the head for a crawler that reads only the head (audit 2026-10-17).
      { rel: "alternate", type: "text/plain", title: "llms.txt", href: "/llms.txt" },
    ],
    // The accessibility settings drawn on <html> before the first paint (src/lib/access.ts); its exact text is in
    // CSP_INLINE_ALLOWLIST, so the policy hashes it.
    scripts: [{ children: ACCESS_BOOTSTRAP }],
  }),
  shellComponent: RootShell,
  component: RootLayout,
  notFoundComponent: PublicNotFound,
  errorComponent: PublicRouteError,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // The accessibility head script may set data attributes on <html> before React hydrates it.
    <html lang={defaultLocale} dir={localeDirection[defaultLocale]} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body data-services={services.mode}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

// An address no `_site` page matches, or a failure above one, never reaches the `_site` layout, so these two
// carry the public chrome and the stylesheet themselves (React 19 hoists the link into the head).
function PublicNotFound() {
  return (
    <>
      {/* Router 1.170.42 runs no `head` of a route whose loader threw `notFound`, so the page carries its own
          description, canonical and noindex (React 19 hoists them), as `unavailableHead` gave it before. */}
      <meta name="description" content="This page could not be found." />
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={absoluteUrl("/")} />
      <link rel="stylesheet" href={appCss} precedence="default" />
      <SiteChrome>
        <NotFound />
      </SiteChrome>
    </>
  );
}

function PublicRouteError(props: ErrorComponentProps) {
  return (
    <>
      <link rel="stylesheet" href={appCss} precedence="default" />
      <SiteChrome>
        <RouteError {...props} />
      </SiteChrome>
    </>
  );
}
