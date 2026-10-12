import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SharedView from "./components/SharedView";
import ViewBoundary from "./components/ViewBoundary";
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
import "katex/dist/katex.min.css";
import "./shell.css";

bootMobile();
if (window.ciroDesktop) document.documentElement.dataset.desktop = window.ciroDesktop.platform;

const shareMatch = /^\/share\/([A-Za-z0-9_-]{16,40})\/?$/.exec(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Last line of defence: never a blank white page. */}
    <ViewBoundary t={(text) => text} onHome={() => window.location.reload()}>
      {shareMatch ? <SharedView id={shareMatch[1]} /> : <App />}
    </ViewBoundary>
  </React.StrictMode>
);

// Install only in production: no service worker intercepts developer HTTP or API tests.
if(import.meta.env.PROD && "serviceWorker" in navigator && !isMobileShell()){
  window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js").catch(()=>{});});
}
