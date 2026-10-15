import { themeHex } from "../../theme.gen.ts";
import { cx, label, placardTitle, sans, serif } from "../style.ts";

/**
 * The head of an issue, set as Afternoon's placard: the title in Cormorant italic on the centre axis, rising into its
 * mask as the film's titles do, and the number under it in letter-spaced capitals. The house is named by the door
 * above it and the colophon below.
 */
export function Masthead({ number }: { number: number }) {
  return (
    <>
      <p
        className={cx(serif.className, "mop-t-title", "mop-ink")}
        style={{
          ...placardTitle,
          margin: "18px 0 0",
          fontSize: "52px",
          lineHeight: "56px",
          fontStyle: "italic",
          color: themeHex.foreground,
          textAlign: "center",
        }}
      >
        <span className="mop-m">
          <span className={cx("mop-r", "mop-d5")}>Place Notes</span>
        </span>
      </p>
      <p
        className={cx(sans.className, "mop-ink2", "mop-k", "mop-d6")}
        style={{
          ...label,
          margin: "12px 0 0",
          color: themeHex.mutedForeground,
          textAlign: "center",
        }}
      >
        {`No. ${String(number)}`}
      </p>
    </>
  );
}
