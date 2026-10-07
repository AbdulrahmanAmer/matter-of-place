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
import { siteConfig } from "../config/site";
import { defaultLocale, localeDirection } from "../lib/strings";
import { services } from "../services";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
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
    ],
  }),
  shellComponent: RootShell,
  component: RootLayout,
  notFoundComponent: PublicNotFound,
  errorComponent: PublicRouteError,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale} dir={localeDirection[defaultLocale]}>
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
