import { useEffect, useRef, useState } from "react";
import { browserPopupRedirectResolver, createUserWithEmailAndPassword, EmailAuthProvider, GoogleAuthProvider, linkWithCredential, linkWithPopup, OAuthProvider, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithCustomToken, signInWithEmailAndPassword, signInWithPopup, type User } from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase-client";
import { ACCOUNT_SESSION_KEY } from "@/lib/account-session";
import { nativeReader, nativeOpen, apiURL } from "@/native/platform";
import { app } from "@/tg/sdk";
import { Button } from "@/ui/Button";
import { StudyNotice } from "@/studies/controls";

const deviceKey = "cj:device-signin-code";
const authMessage = (error: unknown) => {
  const code = (error as { code?: string; message?: string }).code ?? (error as Error).message;
  if (/credential-already-in-use|account-exists-with-different-credential|account_link_conflict/.test(code)) return "That login already belongs to another account. Sign in with its original method. No accounts or balances were merged.";
  if (/recent/.test(code)) return "Please sign out and sign in again, then retry. Linking needs a recent sign-in to both accounts.";
  if (/popup-closed|cancelled/.test(code)) return "Sign-in was cancelled.";
  if (/operation-not-allowed|unauthorized-domain|configuration-not-found/.test(code)) return "This sign-in method still needs to be enabled for CyberJudah. Your saved work is unchanged.";
  if (/invalid-credential|wrong-password|user-not-found/.test(code)) return "The email or password was not accepted.";
  return "Sign-in could not finish. Check your connection and try again. Your saved work is unchanged.";
};
async function request<T>(path: string, body?: unknown, authorization?: string): Promise<T> {
  const response = await fetch(apiURL(path), { method: "POST", credentials: "same-origin", cache: "no-store", headers: { ...(authorization ? { authorization } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "sign_in_failed");
  return data as T;
}

export function AccountSignIn() {
  const queries = useQueryClient(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [user, setUser] = useState<User | null>(auth.currentUser), [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [telegram, setTelegram] = useState(!!app), [match, setMatch] = useState("");
  const [deviceCode] = useState(() => {
    if (nativeReader) return null;
    const code = new URLSearchParams(location.search).get("device");
    if (code && /^[a-f0-9]{64}$/.test(code)) { sessionStorage.setItem(deviceKey, code); history.replaceState(history.state, "", location.pathname); }
    return sessionStorage.getItem(deviceKey);
  });
  useEffect(() => onAuthStateChanged(auth, current => { setUser(current); void queries.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY }); }), [queries]);
  useEffect(() => { if (!app && !nativeReader) void fetch(apiURL("/api/auth/status"), { cache: "no-store", credentials: "same-origin" }).then(r => r.json()).then(s => setTelegram(!!s.user)).catch(() => {}); }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await queries.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY }); }
    catch (e) { setError(authMessage(e)); } finally { setBusy(false); }
  };
  const provider = (kind: "google" | "apple") => kind === "google" ? new GoogleAuthProvider() : new OAuthProvider("apple.com");
  const signIn = (kind: "google" | "apple", link = false) => run(async () => {
    const p = provider(kind);
    if (link && auth.currentUser) await linkWithPopup(auth.currentUser, p, browserPopupRedirectResolver); else await signInWithPopup(auth, p, browserPopupRedirectResolver);
    setUser(auth.currentUser); setMessage(link ? "Sign-in method connected to this account." : "Signed in. Link Telegram once to use your existing Ask balance and chats.");
  });
  const nativeSignIn = () => run(async () => {
    const flow = await request<{ code: string; secret: string; match: string; expires: number }>("/api/auth/device/start");
    setMatch(flow.match);
    await nativeOpen(`https://cyberjudah.io/app/settings/account?device=${flow.code}`);
    // Poll only while the account screen is open; the secret never appears in a URL or storage.
    while (active.current && Date.now() < flow.expires) {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      if (!active.current) return;
      const result = await request<{ pending?: boolean; token?: string }>("/api/auth/device/exchange", { secret: flow.secret });
      if (result.token && active.current) { await signInWithCustomToken(auth, result.token); setMatch(""); setMessage("Signed in. Your linked Ask balance and chats are ready."); return; }
    }
    throw new Error("sign_in_expired");
  });
  return <section className="study-panel"><h2>One account, your Ask balance</h2>
    <p>Connect Telegram once, then use Google, Apple or email to access the same paid Ask balance and conversations. Reading does not require an account.</p>
    {nativeReader ? <><Button disabled={busy} onClick={() => void nativeSignIn()}>{user ? "Change sign-in" : "Sign in securely"}</Button>{match && <p role="status">Match code <strong>{match}</strong> in your browser, approve sign-in, then return here.</p>}</> : <>
      {user ? <><p>Signed in as {user.email || user.displayName || "CyberJudah reader"}.</p>
        <div className="study-toolbar"><Button disabled={busy || user.providerData.some(p => p.providerId === "google.com")} onClick={() => void signIn("google", true)}>{user.providerData.some(p => p.providerId === "google.com") ? "Google connected" : "Connect Google"}</Button><Button disabled={busy || user.providerData.some(p => p.providerId === "apple.com")} onClick={() => void signIn("apple", true)}>{user.providerData.some(p => p.providerId === "apple.com") ? "Apple connected" : "Connect Apple"}</Button></div>
      </> : <div className="study-toolbar"><Button disabled={busy} onClick={() => void signIn("google")}>Sign in with Google</Button><Button disabled={busy} onClick={() => void signIn("apple")}>Sign in with Apple</Button></div>}
      {(!user || !user.providerData.some(p => p.providerId === "password")) && <form onSubmit={e => { e.preventDefault(); void run(async () => {
        if (user) { await linkWithCredential(user, EmailAuthProvider.credential(email.trim(), password)); await sendEmailVerification(user); setMessage("Email sign-in connected. Check your email for verification."); }
        else { await signInWithEmailAndPassword(auth, email.trim(), password); setMessage("Signed in. Link Telegram to use your Ask balance."); }
      }); }}><label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete={user ? "new-password" : "current-password"} required value={password} onChange={e => setPassword(e.target.value)} /></label><div className="study-toolbar">
        <Button disabled={busy} type="submit">{user ? "Connect email" : "Sign in with email"}</Button>
        {!user && <Button disabled={busy || !email || !password} type="button" onClick={() => void run(async () => { const result = await createUserWithEmailAndPassword(auth, email.trim(), password); await sendEmailVerification(result.user); setPassword(""); setMessage("Account created. Check your email for verification, then connect Telegram."); })}>Create account</Button>}
        {!user && <Button disabled={busy || !email} type="button" onClick={() => void run(async () => { await sendPasswordResetEmail(auth, email.trim()); setMessage("If this email has an account, password reset instructions are on their way."); })}>Reset password</Button>}
      </div></form>}
      {telegram && !user && <Button disabled={busy} onClick={() => void run(async () => { const result = await request<{ token: string }>("/api/firebase/token", undefined, app?.initData ? `tma ${app.initData}` : undefined); await signInWithCustomToken(auth, result.token); setMessage("Telegram account ready. Connect another sign-in method below."); })}>Use this Telegram account</Button>}
      {user && (telegram ? <Button disabled={busy} onClick={() => void run(async () => { await request("/api/firebase/link", { idToken: await user.getIdToken(true) }, app?.initData ? `tma ${app.initData}` : undefined); setMessage("Accounts connected. Every linked sign-in uses the same Ask balance and chats."); })}>Link this login with Telegram</Button> : <a className="btn btn--bordered" href="/api/auth/start">Connect Telegram</a>)}
      {deviceCode && <div><p>Only approve if you started sign-in on your own device and its code is <strong>{deviceCode.slice(0, 6).toUpperCase()}</strong>.</p><Button disabled={busy || !user} onClick={() => void run(async () => { await request("/api/auth/device/approve", { code: deviceCode }, `Bearer ${await auth.currentUser!.getIdToken(true)}`); sessionStorage.removeItem(deviceKey); setMessage("Sign-in approved. Return to the CyberJudah app."); })}>Approve device sign-in</Button></div>}
    </>}
    {user && <Button disabled={busy} onClick={() => void run(async () => { if (!nativeReader && !app) { const response = await fetch(apiURL("/api/auth/logout"), { method: "POST", credentials: "same-origin" }); if (!response.ok) throw new Error("sign_out_failed"); } await (await import("@/sync/account")).stopAccountSync(); (await import("@/screens/Ask")).clearAskSession(); setMessage("Signed out of this login."); })}>Sign out of this login</Button>}
    {error && <StudyNotice error>{error}</StudyNotice>}{message && <StudyNotice>{message}</StudyNotice>}
  </section>;
}
