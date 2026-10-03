import type { ReactNode } from "react";
import { Footer } from "./footer";
import { Header } from "./header";

/** The public header and footer around a page. `_site.tsx` and the root's not-found and error pages use it. */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
