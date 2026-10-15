import { Img } from "@react-email/components";
import type { CSSProperties } from "react";
import type { Art } from "../art.ts";
import { cx, sans } from "../style.ts";

declare module "react" {
  interface CSSProperties {
    /** Outlook for Windows ignores `display: none` on a picture; this is the property its Word engine reads. */
    msoHide?: "all";
  }
}

/**
 * One picture of an email, at its display size from `art.ts` (or an address of the site's own media). It stands on the
 * colour of its paper, so with pictures off its place keeps that colour and shows the alt text as a label; `bleed`
 * lets a phone draw it the width of the screen. `night` marks the version Apple Mail shows in dark mode in place of
 * `day`: hidden everywhere else, Outlook included (`mso-hide`).
 */
export function Picture({
  src,
  art,
  alt,
  paper,
  ink,
  bleed = false,
  night = false,
  day = false,
  style,
}: {
  src: string;
  art: Pick<Art, "width" | "height">;
  alt: string;
  paper: string;
  ink: string;
  bleed?: boolean;
  night?: boolean;
  day?: boolean;
  style?: CSSProperties;
}) {
  const shown: CSSProperties = night
    ? { display: "none", maxHeight: 0, overflow: "hidden", msoHide: "all" }
    : { display: "block" };
  return (
    // `loading` keeps React 19 from adding a preload link for the first picture to the head (G-500).
    <Img
      className={cx(bleed && "mop-img", night && "mop-dm", day && "mop-lm")}
      src={src}
      alt={alt}
      width={art.width}
      height={art.height}
      loading="lazy"
      style={{
        ...shown,
        width: `${String(art.width)}px`,
        maxWidth: "100%",
        height: "auto",
        border: 0,
        backgroundColor: paper,
        color: ink,
        fontFamily: sans.fontFamily,
        fontSize: "11px",
        lineHeight: "16px",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        textAlign: "center",
        ...style,
      }}
    />
  );
}
