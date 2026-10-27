import { goBack, topOpenSheet } from "@/tg/hooks";
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
        // Use the reader's own sheet stack and per-tab history floor, as Bible Strong does.
        if ((topOpenSheet() || location.pathname !== "/") && goBack()) return;
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
