import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { signOutAccountFn } from "../lib/account.functions";

/** Ends this session and reloads the page's data, which then answers with the sign-in form (W6 items 7 and 8). */
export function useAccountSignOut(): { signOut: () => void; signingOut: boolean } {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = () => {
    setSigningOut(true);
    void signOutAccountFn().finally(() => {
      setSigningOut(false);
      void router.invalidate();
    });
  };
  return { signOut, signingOut };
}
