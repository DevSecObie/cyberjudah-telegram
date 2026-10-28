import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { api, app, user } from "@/tg/sdk";

export type AccountSession = { available: boolean; user: { id: number; first_name: string } | null; firebaseUid?: string; provider?: string; telegramLinked?: boolean; telegramSession?: { id: number; first_name: string } | null };
export const ACCOUNT_SESSION_KEY = ["account-session"] as const;

/** Display-only adapter for Bible Strong's account card. Never use this identity to authorize
 * requests or choose a wallet: only the server-confirmed linked `session.user` can do that. */
export function useAccountIdentity() {
  const session = useAccountSession();
  const [firebase, setFirebase] = useState<User | null>(null);
  useEffect(() => {
    if (app) return;
    let unsubscribe: (() => void) | undefined, cancelled = false;
    void Promise.all([import("firebase/auth"), import("./firebase-client")]).then(([sdk, client]) => {
      if (!cancelled) unsubscribe = sdk.onAuthStateChanged(client.auth, setFirebase);
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  if (app && user) return { name: [user.first_name, user.last_name].filter(Boolean).join(" "), detail: user.username ? `@${user.username}` : "Connected with Telegram", photo: user.photo_url };
  if (firebase) return { name: firebase.displayName || firebase.email || "Your account", detail: firebase.email || "Signed in", photo: firebase.photoURL };
  const telegram = session.data?.user ?? session.data?.telegramSession;
  return telegram ? { name: telegram.first_name, detail: "Connected with Telegram", photo: null } : null;
}
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
