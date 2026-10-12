import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./lib/desktop";
import { bootMobile, isMobileShell } from "./lib/mobile";
import "./styles.css";
import "./cinematic.css";
import "./settings.css";
import "./white.css";
import "./workbench.css";
import "./workbench-entry.css";
import "./commercial.css";
import "./account.css";
import "./studio.css";
import "./shell.css";

bootMobile();
if (window.ciroDesktop) document.documentElement.dataset.desktop = window.ciroDesktop.platform;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Install only in production: no service worker intercepts developer HTTP or API tests.
if(import.meta.env.PROD && "serviceWorker" in navigator && !isMobileShell()){
  window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js").catch(()=>{});});
}
