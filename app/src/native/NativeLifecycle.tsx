import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { native } from "./platform";

export function NativeLifecycle() {
  const navigate = useNavigate(), location = useLocation();
  useEffect(() => {
    if (!native) return;
    let stopped = false;
    const handle = import("@capacitor/app").then(async ({ App }) => {
      const listener = await App.addListener("backButton", ({ canGoBack }) => {
        // The existing Back/Escape handler closes sheets first.
        if (document.querySelector("[data-sheet-open]")) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return; }
        if (canGoBack && location.pathname !== "/") navigate(-1);
        else if (location.pathname !== "/") navigate("/");
        else void App.minimizeApp();
      });
      if (stopped) await listener.remove();
      return listener;
    });
    return () => { stopped = true; void handle.then(h => h.remove()); };
  }, [navigate, location.pathname]);
  return null;
}
