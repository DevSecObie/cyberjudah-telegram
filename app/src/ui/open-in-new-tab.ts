import { useNavigate } from "react-router";
import { addTab, groupsNow, selectTab, switchGroup } from "@/lib/tabs";
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
    // Bible Strong's goToTab: to the new tab's group, and the tab slides in from the end.
    const go = () => moveTab(() => {
      // A tab closed before the toast is tapped is gone: nothing to go to.
      if (!groupsNow().find((g) => g.id === at.group)?.tabs.some((t) => t.id === at.tab)) return false;
      switchGroup(at.group); navigate(selectTab(at.tab), { replace: true });
    }, "slide", undefined, 1);
    toast("New tab created", { action: { label: "Go to tab", onClick: go } });
  };
}
