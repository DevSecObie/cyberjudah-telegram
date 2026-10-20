import { useNavigate } from "react-router";
import { addTab, selectTab, switchGroup } from "@/lib/tabs";
import { moveTab } from "./tab-motion";
import { useToast } from "./toast";

/**
 * Bible Strong's openInNewTab (app-switcher/utils/useOpenInNewTab): the new tab is added beside
 * the current one, which stays open, and a toast offers to go to it.
 */
export function useOpenInNewTab() {
  const navigate = useNavigate();
  const toast = useToast();
  return (path: string) => {
    const at = addTab(path);
    toast("New tab created", {
      action: { label: "Go to tab", onClick: () => moveTab(() => { switchGroup(at.group); navigate(selectTab(at.tab), { replace: true }); }, "slide") },
    });
  };
}
