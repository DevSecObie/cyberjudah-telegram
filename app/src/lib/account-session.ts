import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { api, app, user } from "@/tg/sdk";

export type AccountSession = { available: boolean; user: { id: number; first_name: string } | null; firebaseUid?: string; provider?: string; telegramLinked?: boolean };
export const ACCOUNT_SESSION_KEY = ["account-session"] as const;
/** Telegram launch identity or the server-verified browser session, never a cached display name. */
export function useAccountSession() {
  const queries = useQueryClient();
  useEffect(() => {
    if (app) return;
    let unsubscribe: (() => void) | undefined, cancelled = false, previous: string | null | undefined;
    void Promise.all([import("firebase/auth"), import("./firebase-client")]).then(([sdk, client]) => {
      if (cancelled) return;
      unsubscribe = sdk.onAuthStateChanged(client.auth, current => {
        const uid = current?.uid ?? null;
        if (previous === undefined) { previous = uid; return; }
        if (previous === uid) return;
        previous = uid;
        queries.setQueryData(ACCOUNT_SESSION_KEY, { available: true, user: null });
        void import("@/screens/Ask").then(m => m.clearAskSession());
        void queries.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY });
      });
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [queries]);
  return useQuery<AccountSession>({
    queryKey: ACCOUNT_SESSION_KEY,
    queryFn: () => api<AccountSession>("/api/auth/status"),
    enabled: !app,
    ...(app ? { initialData: { available: true, user: user ?? null } } : {}),
    staleTime: 0, retry: false, refetchOnWindowFocus: true,
  });
}
