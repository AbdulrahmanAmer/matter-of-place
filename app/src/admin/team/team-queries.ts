import { useAsyncAction } from "../../hooks/use-async-action";
import { requestSignInLink } from "./team-api";

/** The sign-in form's request for a link: its pending, success and error states (components do not call `-api` modules). */
export function useSendSignInLink() {
  return useAsyncAction(requestSignInLink);
}
