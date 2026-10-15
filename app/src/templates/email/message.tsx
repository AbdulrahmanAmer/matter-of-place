import { Light } from "./house/light.tsx";
import type { EmailProps } from "./layout.tsx";

/**
 * The shell a row with no template file is drawn in: the light house, which holds any blocks, with the house's name as
 * its label.
 */
export function Message(props: EmailProps) {
  return <Light {...props} label="Matter of Place" />;
}
