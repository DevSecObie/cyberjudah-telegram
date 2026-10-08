import { useState } from "react";
import { Icon } from "./ui";
import { useToast } from "./toast";
import { api, ApiError, app, haptic, popup } from "@/tg/sdk";

/**
 * "Report this answer": the reader picks a reason, and the admins are told which answer (Ask's
 * chat and the answer's place in it, or the search answer's model) and why. Neither the question,
 * the answer's text nor who reported it is sent (bot/src/report.mjs). Inside Telegram only, where
 * the request can be signed.
 */
export type ReportOf = { kind: "ask"; chat: string; turn: number } | { kind: "search"; model?: string };

export function ReportAnswer({ of }: { of: ReportOf }) {
  const toast = useToast();
  const [sent, setSent] = useState(false);
  if (!app?.initData) return null;
  const report = async () => {
    haptic("select");
    const reason = await popup({ title: "Report this answer", message: "What is wrong with it? Only which answer it is and the reason are sent to the admins, not your question or who you are.", buttons: [{ id: "wrong", type: "default", text: "Wrong or misquoted" }, { id: "harmful", type: "destructive", text: "Harmful or offensive" }, { type: "cancel" }] });
    if (reason !== "wrong" && reason !== "harmful") return;
    try {
      await api("/api/report", { method: "POST", json: { ...of, reason } });
      setSent(true); haptic("success"); toast("Thank you. The admins have been told.", { tone: "success" });
    } catch (e) {
      toast(e instanceof ApiError && e.status === 429 ? "You have sent many reports today. Try again tomorrow." : "The report could not be sent. Try again.", { tone: "error" });
    }
  };
  return (
    <button type="button" className="msg__action" disabled={sent} onClick={() => void report()} aria-label="Report this answer" title="Report this answer">
      <Icon name={sent ? "check" : "alert"} size={16} />{sent ? "Reported" : "Report"}
    </button>
  );
}
