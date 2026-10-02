# Website essentials diagrams (plan B17)

Pictures: [img/essentials-1.png](img/essentials-1.png) every response: headers and cache class,
[img/essentials-2.png](img/essentials-2.png) consent flow, [img/essentials-3.png](img/essentials-3.png) the files every professional site serves.

## 1. Every response: headers by route class

```mermaid
flowchart LR
  REQ([Request]) --> CLS{Route class}
  CLS -->|page| PG["browser: public, max-age=0, must-revalidate. Stored copy at the edge: s-maxage=300, stale-while-revalidate=86400"]
  CLS -->|"/api/public"| AP["catalog JSON: public, max-age=60, ETag, Cache-Tag catalog, same edge lifetime as pages. Writes never cached"]
  CLS -->|"sitemap, robots, llms, feeds"| DOC["public, max-age=3600, s-maxage=3600"]
  CLS -->|"/admin, /api/admin, /api/hooks, POST, 5xx"| AD["private, no-store"]
  CLS -->|fingerprinted asset| AS["public, max-age=31536000, immutable"]
  CLS -->|photograph variant| IM["/media/key from Storage bucket media, content-hashed keys: public, max-age=31536000, immutable. No Vary Accept"]
  PG & AP & DOC & AD & AS & IM --> H["Common headers on all: CSP by inline-script hashes, stored with the cached page, never a per-request nonce. HSTS, nosniff, Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options DENY, Permissions-Policy, COOP same-origin, CORP same-site"]
  H --> CSP{CSP mode}
  CSP -->|"week one: report-only"| RPT["reports to /api/public/csp-report, stored as csp_report events"]
  CSP -->|"clean week: settings.flags.csp_enforce"| ENF[enforced]
  H --> OUT([Response with request id])
```

## 2. Consent flow

```mermaid
flowchart TB
  V([Visitor arrives]) --> GPC{"Global Privacy Control? navigator.globalPrivacyControl after hydration, Sec-GPC on the uncached consent endpoint"}
  GPC -->|yes| DEC[Decline recorded automatically, no analytics]
  GPC -->|no| CK{"readConsent: stored record or mop_consent cookie at the current version?"}
  CK -->|yes, accept| GA["gtag.js, GA4 only, loads after consent through Ga4Loader. No Tag Manager container"]
  CK -->|yes, decline| NO[No third-party scripts, first-party anonymous events only]
  CK -->|no| NOTE["Footer-anchored notice: Allow and No, thank you, equal weight, no wall"]
  NOTE -->|JavaScript on| SET[Choice stored in cookie 12 months and localStorage]
  NOTE -->|JavaScript off| LINK["noscript links /api/consent?set=accept or decline, server sets the cookie, 303, never cached"]
  SET & LINK --> EV[consent_set event, anonymous]
  EV --> GA & NO
  FOOT["Footer: Cookie settings link to /privacy-choices reopens the notice"] -.-> NOTE
  INV["src/config/cookies.ts inventory → /cookies page, CONSENT_VERSION bump when its hash changes"] -.-> CK
```

## 3. The files every professional site serves

```mermaid
flowchart LR
  subgraph IDENT[Identity]
    F1[favicon.ico, favicon.svg light and dark]
    F2[apple-touch-icon, icon-192, icon-512, maskable-512, mstile-150]
    F3[site.webmanifest, browserconfig.xml]
  end
  subgraph WELL[".well-known and roots"]
    W1[security.txt: contact, expires, policy]
    W2[change-password → admin sign-in]
    W3[mta-sts.txt on the mta-sts host, with the DNS records]
    W4[robots.txt dynamic, humans.txt]
  end
  subgraph FEEDS[Discovery]
    S1[sitemap.xml: one urlset, image entries at /media/key, no redirected or taken-down path]
    S2[llms.txt and llms-full.txt]
    S3[feed.xml RSS 2.0 and feed.json with autodiscovery]
    S4[JSON-LD: Organization, WebSite with SearchAction, BreadcrumbList, RealEstateListing, Article, FAQPage]
  end
  subgraph ERR[Error and state pages]
    E1[404 with search and market links]
    E2[410 taken down]
    E3[500 calm with request id]
    E4[503 maintenance via settings.flags.maintenance, Retry-After]
    E5[offline shell via a minimal service worker]
  end
  subgraph LEGAL[Legal pages, dated, linked from every footer]
    L1[Privacy with CCPA section and Do Not Sell or Share]
    L2[Cookies inventory]
    L3[Terms for Professionals]
    L4[Accessibility statement]
    L5["/legal: entity, address, contact"]
  end
```
