import { useNavigate } from "react-router";

import { Feather } from "@/bible/icons";
import { share } from "@/lib/share";
import { useOpenInNewTab } from "./open-in-new-tab";
import { useSheet } from "./sheet";
import { useToast } from "./toast";

type Entry = { title: string; text: string; path: string; relations?: { endpoint: string; label: string } };

/**
 * Bible Strong's entry ⋮ (StrongEntryMenu, the dictionary's menu): Share the link, Copy the text,
 * Edit relations and Open in new tab, from the entry page's header instead of a button over the bar.
 */
export function EntryMenu({ entry }: { entry: Entry | null }) {
  const sheet = useSheet();
  const toast = useToast();
  const navigate = useNavigate();
  const openInNewTab = useOpenInNewTab();
  const open = async () => {
    if (!entry) return;
    const a = await sheet.open({ items: [
      { id: "share", text: "Share the link", icon: <Feather name="share-2" size={16} /> },
      { id: "copy", text: "Copy the text", icon: <Feather name="copy" size={16} /> },
      ...(entry.relations ? [{ id: "relations", text: "Edit relations", icon: <Feather name="git-merge" size={16} /> }] : []),
      { id: "tab", text: "Open in new tab", icon: <Feather name="external-link" size={16} /> },
    ] });
    try {
      if (a?.id === "share") await share({ kind: "note", title: entry.title, text: entry.text.slice(0, 300), sitePath: entry.path });
      else if (a?.id === "copy") { await navigator.clipboard.writeText(`${entry.title}\n\n${entry.text}`); toast("Copied to the clipboard."); }
      else if (a?.id === "relations" && entry.relations) navigate(`/relations?endpoint=${encodeURIComponent(entry.relations.endpoint)}&label=${encodeURIComponent(entry.relations.label)}`);
      else if (a?.id === "tab") openInNewTab(entry.path);
    } catch { toast("Error while sharing."); }
  };
  return <button type="button" className="icon-btn" aria-label="More options" title="More options" disabled={!entry} onClick={() => void open()}><Feather name="more-vertical" size={18} /></button>;
}
