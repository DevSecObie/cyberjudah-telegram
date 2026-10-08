import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Sheet } from "@/bible/ui/Sheet";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/icons";
import { StudyNotice } from "./controls";
import { newStudy, type Study, type StudyBlock } from "./model";
import { getStudy, listStudies, saveStudy } from "./storage";
import "./studies.css";

export function AddToStudy({ blocks, onClose }: { blocks: StudyBlock[]; onClose: () => void }) {
  const [studies, setStudies] = useState<Study[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { listStudies().then(setStudies).catch(() => setError("Study storage is unavailable. Check your browser's storage permissions.")); }, []);
  const add = async (id?: string) => {
    setBusy(true); setError("");
    try {
      const study = id ? await getStudy(id) : newStudy();
      if (!study) throw new Error("This study was removed. Choose another study.");
      const saved = await saveStudy({ ...study, blocks: [...study.blocks, ...blocks] });
      onClose(); navigate(`/studies/${saved.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "The study could not be saved."); } finally { setBusy(false); }
  };
  return <Sheet open onClose={onClose} title="Add to study"><div className="personal-study">
    <p className="study-muted">Keep Scripture, word studies and your own writing together.</p>
    {error && <StudyNotice error>{error}</StudyNotice>}
    <Button disabled={busy} onClick={() => void add()}><Icon name="plus" size={18} />New study</Button>
    {studies.length > 0 && <div className="study-section-heading"><h2>Choose an existing study</h2></div>}
    {studies.map(s => <button className="study-choice" key={s.id} type="button" disabled={busy} onClick={() => void add(s.id)}><Icon name="note" size={20} /><span>{s.title || "Untitled study"}</span><Icon name="chevron" size={16} /></button>)}
  </div></Sheet>;
}
