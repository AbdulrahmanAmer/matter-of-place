import { cx, display, label, serif, sans } from "../style.ts";
import { themeHex } from "../../theme.gen.ts";

/**
 * The head of an issue, set as a nameplate: the title in Cormorant italic, rising into its mask as the film's titles
 * do, and the number under it in letter-spaced capitals. The house is named once, in the running header above.
 */
export function Masthead({ number }: { number: number }) {
  return (
    <>
      <div style={{ overflow: "hidden", padding: "0 0 8px" }}>
        <h1
          className={cx(serif.className, "mop-rise")}
          style={{
            ...display,
            fontSize: "58px",
            fontStyle: "italic",
            lineHeight: "1.02",
            letterSpacing: "-0.015em",
            color: themeHex.foreground,
          }}
        >
          Place Notes
        </h1>
      </div>
      <p className={cx(sans.className, "mop-label")} style={{ ...label, margin: "14px 0 0" }}>
        {`No. ${String(number)}`}
      </p>
    </>
  );
}
