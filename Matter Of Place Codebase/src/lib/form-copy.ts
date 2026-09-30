import { isLive } from "../services";
import { t } from "./strings";

/** Confirmation copy beneath a sent form; depends on whether delivery is live. */
export const sentText = () => (isLive ? t.forms.liveSent : t.forms.localSent);
