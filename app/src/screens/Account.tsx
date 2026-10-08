import { useEffect, useState } from "react";
import { Screen, List, Row, Icon } from "@/ui/ui";
import { Button } from "@/ui/Button";
import { useBackButton } from "@/tg/hooks";
import { app, api, confirm } from "@/tg/sdk";
import { saveFile } from "@/studies/files";
import { exportPersonalStudies, clearPersonalStudies, importPersonalStudies } from "@/studies/storage";
import { CloudBackup } from "@/studies/CloudBackup";
import { StudyFilePicker, StudyNotice } from "@/studies/controls";
import "@/studies/studies.css";

export function Account() {
  useBackButton(true);
  const [state, setState] = useState<{ available: boolean; user: { first_name: string } | null }>(), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => { if (app) { setState({ available: true, user: app.initDataUnsafe.user ?? null }); return; } void api<typeof state>("/api/auth/status").then(setState).catch(() => setError("Account status could not be loaded. Try again when you are online.")); }, []);
  const logout = async () => { try { await api("/api/auth/logout", { method: "POST" }); setState(s => s ? { ...s, user: null } : s); setError(""); } catch { setError("Sign-out could not finish. Please try again."); } };
  return <Screen title="Account" className="study-screen"><div className="personal-study">
    {new URLSearchParams(location.search).has("login") && <StudyNotice error>Telegram sign-in did not finish. Please try again.</StudyNotice>}
    <section className="study-panel"><div className="study-account-identity"><span className="study-emblem"><Icon name="shield" size={26} /></span><div><h2>{state?.user ? state.user.first_name : "Your study, your space"}</h2><p>{state?.user ? "Connected with Telegram" : "Read and study without an account."}</p></div></div>
      {state?.user ? !app && <div className="study-toolbar"><Button appearance="bordered" onClick={() => void logout()}>Sign out</Button></div> : state?.available ? <div className="study-toolbar"><a className="btn btn--prominent" href="/api/auth/start">Sign in with Telegram<Icon name="chevron" size={16} /></a></div> : state ? <p>Telegram sign-in is not available here yet. You can still use your personal studies on this device.</p> : !error && <p role="status">Checking account…</p>}
    </section>
    {error && <StudyNotice error>{error}</StudyNotice>}
    {message && <StudyNotice>{message}</StudyNotice>}
    {state?.user && <CloudBackup />}
    <section className="study-panel"><h2><Icon name="download" size={20} />Keep a copy of your studies</h2><p>Your personal studies and phrase marks are saved on this device. Export a backup before changing devices or clearing browser data.</p><div className="study-toolbar">
      <Button onClick={async () => { try { const archive = await exportPersonalStudies(); await saveFile("cyberjudah-personal-studies.json", JSON.stringify(archive, null, 2)); setError(""); } catch { setError("The backup could not be exported. Your local work is unchanged."); } }}><Icon name="download" size={18} />Export all personal studies</Button>
      <StudyFilePicker label="Restore backup" onFile={async file => { try { if (file.size > 10_000_000) throw new Error("Choose a backup smaller than 10 MB."); const n = await importPersonalStudies(await file.text()); setError(""); setMessage(`Restored ${n} studies as new copies. Existing work is unchanged.`); } catch { setError("This personal-study backup could not be restored. Your existing work is unchanged."); } }} />
    </div><p className="study-footnote">Restoring adds new copies and keeps your existing work.</p></section>
    <div className="study-section-heading"><h2>Privacy & storage</h2></div><List>
      <Row title="Privacy and account data" icon="shield" href="/privacy" sub="Review your data and account controls" />
      <Row title="Delete personal studies on this device" icon="trash" sub="Removes studies and phrase marks from this device" onClick={async () => { if (!await confirm("Delete all personal studies and phrase marks on this device? Export them first if you want to keep a copy.")) return; try { await clearPersonalStudies(); setError(""); setMessage("Personal studies and phrase marks were removed from this device."); } catch { setError("Deletion could not finish. Please try again."); } }} />
    </List>
  </div></Screen>;
}
