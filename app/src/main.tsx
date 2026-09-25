import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { SheetProvider } from "./ui/sheet";
import { boot } from "./tg/sdk";
import "./styles.css";

boot({ bg: "#05070f", header: "#05070f", bottomBar: "#05070f" });

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SheetProvider>
          <App />
        </SheetProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
