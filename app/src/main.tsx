import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { SheetProvider } from "./ui/sheet";
import { ToastProvider } from "./ui/toast";
import { boot } from "./tg/sdk";
import { installBackGuard } from "./lib/backguard";
import "@telegram-apps/telegram-ui/dist/styles.css";
import "./styles.css";

// Vite's BASE_URL always ends in "/" ("/app/" in production, "/" in dev), but
// React Router's basename must NOT: with basename "/app/", a visit to "/app"
// (no trailing slash, which is the natural URL) matches no route and the app
// renders blank. Stripping it makes both "/app" and "/app/..." work.
//
// The same build is served at the Worker's root too (workers.dev, which the bot's menu button
// and "Open CyberJudah" buttons point at). There the path does not start with "/app", and a
// router with basename "/app" matches nothing and renders blank; so the base applies only when
// the page was opened under it.
const built = import.meta.env.BASE_URL.replace(/\/+$/, "");
const here = location.pathname;
const basename = built && (here === built || here.startsWith(`${built}/`)) ? built : "/";

boot({ bg: "#05070f", header: "#05070f", bottomBar: "#05070f" });
// Before the router reads the history: a back step must never leave the app for a blank page.
installBackGuard();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <ToastProvider>
        <SheetProvider>
          <App />
        </SheetProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
