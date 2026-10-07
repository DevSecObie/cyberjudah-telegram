import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { SheetProvider } from "./ui/sheet";
import { ToastProvider } from "./ui/toast";
import { app, boot } from "./tg/sdk";
import { installBackGuard } from "./lib/backguard";
import { routerBasename } from "@shared/basename.mjs";
import { registerOfflineShell } from "./resources/offline-shell";
import "@telegram-apps/telegram-ui/dist/styles.css";
import "./styles.css";

// "/app" or "/" for the page being opened: see shared/basename.mjs (a blank app otherwise).
const basename = routerBasename(import.meta.env.BASE_URL, location.pathname);

// Telegram's chrome in the page's own colour: index.html has already restored the saved palette
// (cj:palette) or the theme's tokens, so the computed canvas is what the reader will see.
const canvas = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || "#05070f";
boot({ bg: canvas, header: canvas, bottomBar: canvas });
// Before the router reads the history: a back step must never leave the app for a blank page.
// Only inside Telegram: in a plain browser, Back must be free to leave the site.
if (app) installBackGuard();
registerOfflineShell(basename);

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
