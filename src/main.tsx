import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./index.css";
import "./i18n";

import { useAppStore } from "./store";
import i18n from "./i18n";

async function boot() {
  // Await the Tauri Store silent migration and disk load
  await useAppStore.getState().initStore();

  const lang = useAppStore.getState().lang;
  if (lang) {
    await i18n.changeLanguage(lang);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}

boot();
