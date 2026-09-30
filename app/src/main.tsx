import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { SheetProvider } from "./ui/sheet";
import { boot } from "./tg/sdk";
import "@telegram-apps/telegram-ui/dist/styles.css";
import "./styles.css";

// Vite's BASE_URL always ends in "/" ("/app/" in production, "/" in dev), but
// React Router's basename must NOT: with basename "/app/", a visit to "/app"
// (no trailing slash, which is the natural URL) matches no route and the app
// renders blank. Stripping it makes both "/app" and "/app/..." work.
const basename = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";

boot({ bg: "#05070f", header: "#05070f", bottomBar: "#05070f" });

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <SheetProvider>
          <App />
        </SheetProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
