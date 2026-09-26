import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { applyAppearance, loadPrefs, resolveAppearance } from "./theme/appearance";
import { AppearanceProvider } from "./theme/AppearanceContext";

// Apply the saved theme before the first paint (no light flash on dark themes).
applyAppearance(resolveAppearance(loadPrefs()));

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppearanceProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppearanceProvider>
  </StrictMode>,
);
