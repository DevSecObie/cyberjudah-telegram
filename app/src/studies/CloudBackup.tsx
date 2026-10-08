import { useEffect, useState } from "react";
import { api, confirm } from "@/tg/sdk";
import { exportPersonalStudies, importPersonalStudies } from "./storage";
import { saveFile } from "./files";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/icons";
import { StudyNotice } from "./controls";

type Backup = { revision: number; updated: string | null; archive: unknown };
export function CloudBackup() {
  const [remote, setRemote] = useState<Backup>(), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { try { setRemote(await api<Backup>("/api/study-backup")); setStatus(""); } catch { setStatus("Cloud backup could not be loaded. Your local work is unchanged."); } };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!remote) return;
    if (remote.archive && !await confirm("Replace the cloud study backup with this device's studies and phrase marks? Download or restore the previous backup first if you need it.")) return;
    setBusy(true);
    try {
      const archive = await exportPersonalStudies(), body = { revision: remote.revision, archive };
      if (new TextEncoder().encode(JSON.stringify(body)).length > 1_000_000) throw new Error("This backup is over the 1 MB cloud limit. Use Export all personal studies to keep a file backup.");
      const result = await api<{ revision: number; updated: string }>("/api/study-backup", { method: "PUT", json: body });
      setRemote({ ...result, archive }); setStatus("Cloud backup saved.");
    } catch (e) { setStatus(e instanceof Error && e.message.includes("1 MB") ? e.message : "The backup was not saved. Another device may have changed it. Reload the cloud backup before trying again."); } finally { setBusy(false); }
  };
  return <section className="study-panel"><h2><Icon name="copy" size={20} />Cloud backup</h2><p>Keep a snapshot with your Telegram account. Save and restore when you need to move studies between devices. Edits do not sync automatically.</p>
    <p>{remote?.updated ? `Last saved ${new Date(remote.updated).toLocaleString()}` : remote ? "No cloud backup yet." : "Loading…"}</p>
    <div className="study-toolbar"><Button disabled={busy || !remote} onClick={() => void save()}>Save cloud backup</Button><Button appearance="plain" disabled={busy} onClick={() => void load()}>Reload cloud backup</Button>
      {remote?.archive != null && <><Button appearance="bordered" disabled={busy} onClick={async () => { try { await saveFile("cyberjudah-cloud-studies.json", JSON.stringify(remote.archive, null, 2)); } catch { setStatus("The download could not finish. Please try again."); } }}>Download cloud backup</Button><Button appearance="bordered" disabled={busy} onClick={async () => { if (!await confirm("Add the cloud studies to this device as copies? Existing studies stay unchanged.")) return; setBusy(true); try { const n = await importPersonalStudies(JSON.stringify(remote.archive)); setStatus(`Restored ${n} studies as copies, plus phrase marks.`); } catch { setStatus("The cloud backup could not be restored. Your existing work is unchanged."); } finally { setBusy(false); } }}>Restore cloud backup</Button></>}
    </div>{status && <StudyNotice>{status}</StudyNotice>}
  </section>;
}
