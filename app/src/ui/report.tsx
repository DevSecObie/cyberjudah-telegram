import { useState } from "react";
import { Icon } from "./ui";
import { useToast } from "./toast";
import { api, ApiError, features, haptic, popup } from "@/tg/sdk";
import { useAccountSession } from "@/lib/account-session";
import { useSheet } from "./sheet";

/**
 * "Report this answer": the reader picks a reason, and the admins are told which answer (Ask's
 * chat and the answer's place in it, or the search answer's model) and why. Neither the question,
 * the answer's text nor who reported it is sent (bot/src/report.mjs). Available to every
 * server-verified account, including linked Firebase users in the web and native apps.
 */
export type ReportOf = { kind: "ask"; chat: string; turn: number } | { kind: "search"; model?: string };

export function ReportAnswer({ of }: { of: ReportOf }) {
  const toast = useToast();
  const sheet = useSheet(), { data: session } = useAccountSession();
  const [sent, setSent] = useState(false), [busy, setBusy] = useState(false);
  if (!session?.user) return null;
  const report = async () => {
    haptic("select");
    const reason = features.popups
      ? await popup({ title: "Report this answer", message: "What is wrong with it? Only which answer it is and the reason are sent to the admins, not your question or who you are.", buttons: [{ id: "wrong", type: "default", text: "Wrong or misquoted" }, { id: "harmful", type: "destructive", text: "Harmful or offensive" }, { type: "cancel" }] })
      : (await sheet.open({ title: "Report this answer", items: [
        { id: "wrong", text: "Wrong or misquoted", hint: "Send the answer reference and reason only." },
        { id: "harmful", text: "Harmful or offensive", hint: "Your question and identity are not included." },
      ] }))?.id;
    if (reason !== "wrong" && reason !== "harmful") return;
    setBusy(true);
    try {
      await api("/api/report", { method: "POST", json: { ...of, reason } });
      setSent(true); haptic("success"); toast("Thank you. Your report was submitted.", { tone: "success" });
    } catch (e) {
      toast(e instanceof ApiError && e.status === 429 ? "You have sent many reports today. Try again tomorrow." : "The report could not be sent. Try again.", { tone: "error" });
    } finally { setBusy(false); }
  };
  return (
    <button type="button" className="msg__action" disabled={sent || busy} onClick={() => void report()} aria-label="Report this answer" title="Report this answer">
      <Icon name={sent ? "check" : "alert"} size={16} />{sent ? "Reported" : "Report"}
    </button>
  );
}
